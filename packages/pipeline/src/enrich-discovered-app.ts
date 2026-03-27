import { createDb } from "@versioneer/db";
import { sparkleParser, githubReleasesParser } from "@versioneer/parsers";
import { discoveredApps } from "@versioneer/schema";
import { toGitHubApiReleasesUrl } from "@versioneer/validation";
import { eq } from "drizzle-orm";

import { fetchAndParse, extractIconUrl } from "./scrape-html";
import { githubApiHeaders } from "./types";

export interface EnrichmentResult {
  enrichmentStatus: "success" | "failed" | "skipped";
  enrichmentError?: string;
  enrichedVendorName: string | null;
  enrichedHomepageUrl: string | null;
  enrichedLatestVersion: string | null;
  enrichedLatestPublishedAt: string | null;
  enrichedReleaseCount: number | null;
  enrichedFeedTitle: string | null;
  sourceValidationStatus: "valid" | "invalid" | "timeout" | "untested";
  confidenceScore: number;
}

/** Maximum age in ms before enrichment is considered stale and re-runs. */
export const ENRICHMENT_STALE_MS = 24 * 60 * 60 * 1000;

/**
 * Returns true if the discovered app should be (re-)enriched.
 */
export function shouldEnrich(row: {
  enrichmentStatus: string;
  enrichedAt: string | null;
}): boolean {
  if (row.enrichmentStatus === "pending") return true;
  if (!row.enrichedAt) return true;
  const age = Date.now() - new Date(row.enrichedAt).getTime();
  return age > ENRICHMENT_STALE_MS;
}

/**
 * Enriches a discovered app by fetching and parsing its update feed,
 * extracting vendor/homepage metadata, and computing a confidence score.
 *
 * Idempotent — calling again re-enriches with fresh data.
 */
export async function enrichDiscoveredApp(params: {
  discoveredAppId: string;
  db: ReturnType<typeof createDb>;
  githubToken?: string;
  assetsBucket?: R2Bucket;
}): Promise<EnrichmentResult> {
  const { discoveredAppId, db, githubToken } = params;

  const row = await db
    .select()
    .from(discoveredApps)
    .where(eq(discoveredApps.id, discoveredAppId))
    .get();

  if (!row) {
    return {
      enrichmentStatus: "failed",
      enrichmentError: "Discovered app not found",
      enrichedVendorName: null,
      enrichedHomepageUrl: null,
      enrichedLatestVersion: null,
      enrichedLatestPublishedAt: null,
      enrichedReleaseCount: null,
      enrichedFeedTitle: null,
      sourceValidationStatus: "untested",
      confidenceScore: 0,
    };
  }

  // Mark in-progress
  await db
    .update(discoveredApps)
    .set({ enrichmentStatus: "in_progress", updatedAt: new Date().toISOString() })
    .where(eq(discoveredApps.id, discoveredAppId));

  const result: EnrichmentResult = {
    enrichmentStatus: "success",
    enrichedVendorName: null,
    enrichedHomepageUrl: null,
    enrichedLatestVersion: null,
    enrichedLatestPublishedAt: null,
    enrichedReleaseCount: null,
    enrichedFeedTitle: null,
    sourceValidationStatus: "untested",
    confidenceScore: 0,
  };

  try {
    // Try Sparkle feed first
    if (row.sparkleFeedUrl) {
      await enrichFromSparkleFeed(row.sparkleFeedUrl, result);
    }

    // Try GitHub/Electron feed if no valid source yet
    if (result.sourceValidationStatus !== "valid" && row.electronUpdateUrl) {
      const apiUrl = toGitHubApiReleasesUrl(row.electronUpdateUrl);
      if (apiUrl) {
        await enrichFromGitHubReleases(apiUrl, result, githubToken);
      }
    }

    // Extract vendor name from code signing authority if not already set
    if (!result.enrichedVendorName && row.codeSigningAuthority) {
      result.enrichedVendorName = extractVendorFromSigningAuthority(row.codeSigningAuthority);
    }

    // Use Homebrew Cask homepage as fallback if no other homepage found
    if (!result.enrichedHomepageUrl && row.homebrewCaskHomepage) {
      result.enrichedHomepageUrl = row.homebrewCaskHomepage;
    }

    // Compute confidence score
    result.confidenceScore = computeConfidenceScore({
      hasBundleId: !!row.bundleId,
      hasValidFeed: result.sourceValidationStatus === "valid",
      hasReleases: (result.enrichedReleaseCount ?? 0) > 0,
      hasVendorInfo: !!result.enrichedVendorName,
      hasHomepageUrl: !!result.enrichedHomepageUrl,
      hasHomebrewCask: !!row.homebrewCaskToken,
    });

    // Scrape homepage for icon if none exists yet
    if (params.assetsBucket && !row.iconR2Key) {
      const homepage = result.enrichedHomepageUrl;
      if (homepage) {
        const iconKey = await scrapeHomepageIcon(homepage, params.assetsBucket, row.lookupKey);
        if (iconKey) {
          await db
            .update(discoveredApps)
            .set({ iconR2Key: iconKey, updatedAt: new Date().toISOString() })
            .where(eq(discoveredApps.id, discoveredAppId));
        }
      }
    }

    // Persist enrichment results
    const now = new Date().toISOString();
    await db
      .update(discoveredApps)
      .set({
        enrichmentStatus: result.enrichmentStatus,
        enrichmentError: null,
        enrichedAt: now,
        enrichedVendorName: result.enrichedVendorName ?? null,
        enrichedHomepageUrl: result.enrichedHomepageUrl ?? null,
        enrichedLatestVersion: result.enrichedLatestVersion ?? null,
        enrichedLatestPublishedAt: result.enrichedLatestPublishedAt ?? null,
        enrichedReleaseCount: result.enrichedReleaseCount ?? null,
        enrichedFeedTitle: result.enrichedFeedTitle ?? null,
        sourceValidationStatus: result.sourceValidationStatus,
        confidenceScore: result.confidenceScore,
        updatedAt: now,
      })
      .where(eq(discoveredApps.id, discoveredAppId));
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    result.enrichmentStatus = "failed";
    result.enrichmentError = errorMsg;

    await db
      .update(discoveredApps)
      .set({
        enrichmentStatus: "failed",
        enrichmentError: errorMsg,
        enrichedAt: new Date().toISOString(),
        confidenceScore: result.confidenceScore,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(discoveredApps.id, discoveredAppId));
  }

  return result;
}

// ──────────────────────────────────────────────────────────
// Feed enrichment helpers
// ──────────────────────────────────────────────────────────

async function enrichFromSparkleFeed(url: string, result: EnrichmentResult): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  } catch {
    result.sourceValidationStatus = "timeout";
    return;
  }

  if (!response.ok) {
    result.sourceValidationStatus = "invalid";
    return;
  }

  const body = await response.text();

  // Extract channel-level RSS metadata (not handled by the release parser)
  result.enrichedFeedTitle = extractRssTag(body, "title");
  result.enrichedHomepageUrl = extractRssTag(body, "link");

  // Parse releases
  const parsed = sparkleParser.parse(body);
  if (parsed.releases.length === 0) {
    result.sourceValidationStatus = "invalid";
    return;
  }

  result.sourceValidationStatus = "valid";
  result.enrichedReleaseCount = parsed.releases.length;

  // Find latest stable release
  const latest =
    parsed.releases.find((release) => release.channel === "stable" && !release.isPrerelease) ??
    parsed.releases[0];
  if (latest) {
    result.enrichedLatestVersion = latest.versionRaw;
    result.enrichedLatestPublishedAt = latest.publishedAt ?? null;
  }

  // Try to extract vendor from feed title (e.g., "iTerm2 - Releases" → "iTerm2")
  if (!result.enrichedVendorName && result.enrichedFeedTitle) {
    const title = result.enrichedFeedTitle;
    // Feed titles like "AppName Changelog" or "AppName - Updates" often contain the app name
    // but not the vendor — skip these. Only use if it looks like a different name.
    if (title.includes(" by ")) {
      const vendorPart = title.split(" by ").pop()?.trim();
      if (vendorPart) result.enrichedVendorName = vendorPart;
    }
  }
}

async function enrichFromGitHubReleases(
  apiUrl: string,
  result: EnrichmentResult,
  githubToken?: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(apiUrl, {
      signal: AbortSignal.timeout(10_000),
      headers: githubApiHeaders(githubToken),
    });
  } catch {
    result.sourceValidationStatus = "timeout";
    return;
  }

  if (!response.ok) {
    result.sourceValidationStatus = "invalid";
    return;
  }

  const body = await response.text();
  const parsed = githubReleasesParser.parse(body);

  if (parsed.releases.length === 0) {
    result.sourceValidationStatus = "invalid";
    return;
  }

  result.sourceValidationStatus = "valid";
  result.enrichedReleaseCount = parsed.releases.length;

  const latest =
    parsed.releases.find((release) => release.channel === "stable" && !release.isPrerelease) ??
    parsed.releases[0];
  if (latest) {
    result.enrichedLatestVersion = latest.versionRaw;
    result.enrichedLatestPublishedAt = latest.publishedAt ?? null;
  }

  // Extract homepage from GitHub API URL: repos/{owner}/{repo} → github.com/{owner}/{repo}
  if (!result.enrichedHomepageUrl) {
    const match = apiUrl.match(/repos\/([^/]+\/[^/]+)/);
    if (match) {
      result.enrichedHomepageUrl = `https://github.com/${match[1]}`;
    }
  }
}

// ──────────────────────────────────────────────────────────
// Metadata extraction helpers
// ──────────────────────────────────────────────────────────

/**
 * Extracts a top-level RSS tag value from the channel element (not from items).
 * e.g., `<channel><title>AppName</title>...</channel>`
 */
function extractRssTag(xml: string, tag: string): string | null {
  // Get the <channel> block, excluding <item> elements to avoid picking up per-release titles
  const channelMatch = xml.match(/<channel>([\s\S]*?)(?:<item>|$)/i);
  if (!channelMatch) return null;
  const channelHeader = channelMatch[1]!;

  // Match the tag (handle CDATA)
  const cdataPattern = new RegExp(`<${tag}[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`, "i");
  const cdataMatch = channelHeader.match(cdataPattern);
  if (cdataMatch?.[1]) return cdataMatch[1].trim();

  const simplePattern = new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, "i");
  const simpleMatch = channelHeader.match(simplePattern);
  if (simpleMatch?.[1]) return simpleMatch[1].trim();

  return null;
}

/**
 * Extracts a vendor/company name from a macOS code signing authority string.
 * e.g., "Developer ID Application: Company Name (TEAMID)" → "Company Name"
 */
function extractVendorFromSigningAuthority(authority: string): string | null {
  // Pattern: "Developer ID Application: Vendor Name (TEAMID)"
  const match = authority.match(/:\s*(.+?)\s*\([A-Z0-9]+\)\s*$/);
  if (match?.[1]) return match[1].trim();

  // Pattern: "Apple Development: Name (TEAMID)"
  const devMatch = authority.match(/:\s*(.+?)\s*\([A-Z0-9]+\)\s*$/);
  if (devMatch?.[1]) return devMatch[1].trim();

  return null;
}

/**
 * Computes a 0-100 confidence score based on available data quality.
 */
function computeConfidenceScore(factors: {
  hasBundleId: boolean;
  hasValidFeed: boolean;
  hasReleases: boolean;
  hasVendorInfo: boolean;
  hasHomepageUrl: boolean;
  hasHomebrewCask?: boolean;
}): number {
  let score = 0;
  if (factors.hasBundleId) score += 20;
  if (factors.hasValidFeed) score += 30;
  if (factors.hasReleases) score += 20;
  if (factors.hasVendorInfo) score += 15;
  if (factors.hasHomepageUrl) score += 15;
  // Homebrew Cask match boosts confidence when no other feed is valid
  if (factors.hasHomebrewCask && !factors.hasValidFeed) score += 25;
  return Math.min(score, 100);
}

// ──────────────────────────────────────────────────────────
// Homepage icon scraping
// ──────────────────────────────────────────────────────────

async function scrapeHomepageIcon(
  homepageUrl: string,
  bucket: R2Bucket,
  lookupKey: string,
): Promise<string | null> {
  try {
    const doc = await fetchAndParse(homepageUrl);
    if (!doc) return null;

    const iconUrl = extractIconUrl(doc, homepageUrl);
    if (!iconUrl) return null;

    const iconResponse = await fetch(iconUrl, { signal: AbortSignal.timeout(10_000) });
    if (!iconResponse.ok) return null;

    const contentType = iconResponse.headers.get("content-type") ?? "";
    if (!contentType.startsWith("image/")) return null;

    const body = await iconResponse.arrayBuffer();
    if (body.byteLength > 512 * 1024) return null;

    const ext = contentType.includes("png")
      ? "png"
      : contentType.includes("jpeg") || contentType.includes("jpg")
        ? "jpg"
        : contentType.includes("svg")
          ? "svg"
          : contentType.includes("webp")
            ? "webp"
            : "png";

    const keyBytes = new TextEncoder().encode(lookupKey);
    const keyDigest = await crypto.subtle.digest("SHA-256", keyBytes);
    const lookupKeyHash = Array.from(new Uint8Array(keyDigest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    const contentDigest = await crypto.subtle.digest("SHA-256", body);
    const contentHash = Array.from(new Uint8Array(contentDigest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);

    const r2Key = `discovered-icons/${lookupKeyHash}/${contentHash}.${ext}`;

    await bucket.put(r2Key, body, {
      httpMetadata: {
        contentType,
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    return r2Key;
  } catch {
    return null;
  }
}
