import { createDb } from "@versioneer/db";
import { appAliases, discoveredApps, generateId, idPrefixes } from "@versioneer/db";
import { eq, and, isNotNull, or } from "drizzle-orm";

import type { Env } from "./types";

const CASK_INDEX_URL = "https://formulae.brew.sh/api/cask.json";
const ETAG_KV_KEY = "cask-index-etag";
const LAST_SYNC_KV_KEY = "cask-index-last-sync";
const SYNC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

interface CaskIndexEntry {
  token: string;
  name?: string[];
  version: string;
  homepage?: string;
  url?: string;
  sha256?: string;
  auto_updates?: boolean;
  artifacts?: unknown[];
}

export interface CaskIndexSyncJob {
  reason: string;
  force?: boolean;
}

/**
 * Extracts bundle IDs from a cask entry's artifacts.
 * Looks at zap/trash paths and uninstall/quit directives.
 */
export function extractBundleIdsFromCask(artifacts: unknown[]): string[] {
  const bundleIds = new Set<string>();
  const bundleIdPattern = /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+){2,}$/;

  for (const artifact of artifacts) {
    if (typeof artifact !== "object" || artifact === null) continue;
    const obj = artifact as Record<string, unknown>;

    // Check zap.trash paths for bundle IDs
    if (Array.isArray(obj.zap)) {
      for (const zapEntry of obj.zap) {
        if (typeof zapEntry !== "object" || zapEntry === null) continue;
        const trash = (zapEntry as Record<string, unknown>).trash;
        if (Array.isArray(trash)) {
          for (const path of trash) {
            if (typeof path !== "string") continue;
            extractBundleIdFromPath(path, bundleIds);
          }
        }
      }
    }

    // Check uninstall.quit for bundle IDs (these are explicit bundle IDs)
    if (Array.isArray(obj.uninstall)) {
      for (const entry of obj.uninstall) {
        if (typeof entry !== "object" || entry === null) continue;
        const quit = (entry as Record<string, unknown>).quit;
        if (typeof quit === "string" && bundleIdPattern.test(quit)) {
          bundleIds.add(quit.toLowerCase());
        } else if (Array.isArray(quit)) {
          for (const q of quit) {
            if (typeof q === "string" && bundleIdPattern.test(q)) {
              bundleIds.add(q.toLowerCase());
            }
          }
        }
        const signal = (entry as Record<string, unknown>).signal;
        if (typeof signal === "object" && signal !== null) {
          for (const key of Object.keys(signal as Record<string, unknown>)) {
            if (bundleIdPattern.test(key)) {
              bundleIds.add(key.toLowerCase());
            }
          }
        }
      }
    }
  }

  return [...bundleIds];
}

function extractBundleIdFromPath(path: string, bundleIds: Set<string>): void {
  const bundleIdPattern = /^[a-zA-Z][a-zA-Z0-9-]*(\.[a-zA-Z0-9-]+){2,}$/;
  // Group containers strip team ID prefix, leaving shorter IDs (e.g. "com.1password")
  const shortBundleIdPattern = /^[a-zA-Z][a-zA-Z0-9-]*\.[a-zA-Z0-9-]+$/;

  // Patterns like ~/Library/Preferences/com.example.app.plist
  const prefPlistMatch = path.match(/~\/Library\/Preferences\/([a-zA-Z][a-zA-Z0-9.-]+)\.plist$/);
  if (prefPlistMatch?.[1] && bundleIdPattern.test(prefPlistMatch[1])) {
    bundleIds.add(prefPlistMatch[1].toLowerCase());
    return;
  }

  // Group Containers have team ID prefix: e.g. "2BUA8C4S2C.com.1password"
  const groupContainerMatch = path.match(
    /~\/Library\/Group Containers\/[A-Z0-9]+\.([a-zA-Z][a-zA-Z0-9]+(?:\.[a-zA-Z0-9-]+)*)\/?$/,
  );
  if (groupContainerMatch?.[1] && shortBundleIdPattern.test(groupContainerMatch[1])) {
    bundleIds.add(groupContainerMatch[1].toLowerCase());
    return;
  }

  // Patterns like ~/Library/Containers/com.example.app
  const containerPaths = [
    /~\/Library\/Containers\/([a-zA-Z][a-zA-Z0-9.-]+)\/?$/,
    /~\/Library\/Caches\/([a-zA-Z][a-zA-Z0-9.-]+)\/?$/,
    /~\/Library\/Application Support\/([a-zA-Z][a-zA-Z0-9.-]+)\/?$/,
  ];

  for (const pattern of containerPaths) {
    const match = path.match(pattern);
    if (match?.[1] && bundleIdPattern.test(match[1])) {
      bundleIds.add(match[1].toLowerCase());
      return;
    }
  }
}

/**
 * Extract appcast-like URLs from cask artifacts (livecheck or appcast stanzas).
 * Many casks reference Sparkle appcast URLs in their metadata.
 */
function extractAppcastUrl(cask: CaskIndexEntry): string | undefined {
  if (!cask.artifacts) return undefined;
  for (const artifact of cask.artifacts) {
    if (typeof artifact !== "object" || artifact === null) continue;
    const obj = artifact as Record<string, unknown>;
    // Some casks have explicit appcast entries
    if (typeof obj.appcast === "string") return obj.appcast;
  }
  return undefined;
}

export async function handleCaskIndexSync(job: CaskIndexSyncJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date().toISOString();

  // Check if sync is needed (unless forced)
  if (!job.force) {
    const lastSync = await env.CONFIG_KV.get(LAST_SYNC_KV_KEY);
    if (lastSync) {
      const elapsed = Date.now() - new Date(lastSync).getTime();
      if (elapsed < SYNC_INTERVAL_MS) {
        console.log(`Cask index sync skipped: last sync ${Math.round(elapsed / 60000)}m ago`);
        return;
      }
    }
  }

  // Fetch the cask index with ETag caching
  const headers: Record<string, string> = {
    "User-Agent": "Versioneer/1.0 (https://versioneer.app)",
  };
  const lastEtag = await env.CONFIG_KV.get(ETAG_KV_KEY);
  if (lastEtag && !job.force) {
    headers["If-None-Match"] = lastEtag;
  }

  const response = await fetch(CASK_INDEX_URL, { headers });

  if (response.status === 304) {
    console.log("Cask index not modified (304)");
    await env.CONFIG_KV.put(LAST_SYNC_KV_KEY, now);
    return;
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch cask index: HTTP ${response.status}`);
  }

  // Store ETag for next request
  const etag = response.headers.get("etag");
  if (etag) {
    await env.CONFIG_KV.put(ETAG_KV_KEY, etag);
  }

  const casks = (await response.json()) as CaskIndexEntry[];
  console.log(`Fetched ${casks.length} casks from index`);

  // Build a map of cask bundle IDs -> cask entries
  const casksByBundleId = new Map<string, CaskIndexEntry>();

  for (const cask of casks) {
    if (!cask.version || cask.version === "latest") continue;

    // Extract bundle IDs from artifacts
    if (cask.artifacts) {
      const bundleIds = extractBundleIdsFromCask(cask.artifacts);
      for (const bid of bundleIds) {
        casksByBundleId.set(bid, cask);
      }
    }
  }

  // Persist a lightweight bundle-ID-to-cask-token index in KV for on-demand lookups
  const bundleIdToCask: Record<string, string> = {};
  for (const [bid, cask] of casksByBundleId) {
    bundleIdToCask[bid] = cask.token;
  }
  await env.CONFIG_KV.put("cask-bundle-id-map", JSON.stringify(bundleIdToCask));

  // Load discovered apps with bundle IDs
  const discoveredWithBundleId = await db
    .select({
      id: discoveredApps.id,
      bundleId: discoveredApps.bundleId,
      appName: discoveredApps.appName,
      homebrewCaskToken: discoveredApps.homebrewCaskToken,
    })
    .from(discoveredApps)
    .where(
      and(
        isNotNull(discoveredApps.bundleId),
        or(eq(discoveredApps.status, "pending"), eq(discoveredApps.status, "linked")),
      ),
    )
    .all();

  // Load existing homebrew_cask aliases to avoid duplicates
  const existingCaskAliases = await db
    .select({ appId: appAliases.appId, value: appAliases.normalizedValue })
    .from(appAliases)
    .where(eq(appAliases.aliasType, "homebrew_cask"))
    .all();
  const existingCaskTokens = new Set(existingCaskAliases.map((a) => a.value));

  // Load existing bundle_id aliases for matching against onboarded apps
  const bundleIdAliases = await db
    .select({
      appId: appAliases.appId,
      normalizedValue: appAliases.normalizedValue,
    })
    .from(appAliases)
    .where(and(eq(appAliases.aliasType, "bundle_id"), eq(appAliases.isActive, true)))
    .all();

  let bundleIdMatches = 0;
  let errors = 0;
  const matchedCaskTokens = new Set<string>();

  // --- Phase 1: Bundle ID matching against onboarded apps ---
  for (const alias of bundleIdAliases) {
    const cask = casksByBundleId.get(alias.normalizedValue);
    if (!cask || matchedCaskTokens.has(cask.token)) continue;
    matchedCaskTokens.add(cask.token);

    if (!existingCaskTokens.has(cask.token)) {
      try {
        await db.insert(appAliases).values({
          id: generateId(idPrefixes.alias),
          appId: alias.appId,
          aliasType: "homebrew_cask",
          value: cask.token,
          normalizedValue: cask.token,
          isExact: true,
          priority: 0,
          confidenceWeight: 80,
          source: "cask-index-sync",
          isActive: true,
          createdAt: now,
        });
        bundleIdMatches++;
      } catch (e) {
        console.error(`Failed to create cask alias for ${cask.token}:`, e);
        errors++;
      }
    }
  }

  // --- Phase 2: Bundle ID matching against discovered apps ---
  for (const dapp of discoveredWithBundleId) {
    if (!dapp.bundleId) continue;
    const normalizedBid = dapp.bundleId.toLowerCase();
    const cask = casksByBundleId.get(normalizedBid);
    if (!cask || dapp.homebrewCaskToken === cask.token) continue;

    try {
      const appcastUrl = extractAppcastUrl(cask);
      await db
        .update(discoveredApps)
        .set({
          homebrewCaskToken: cask.token,
          homebrewCaskVersion: cask.version.split(",")[0]?.trim(),
          homebrewCaskAppcastUrl: appcastUrl ?? null,
          homebrewCaskHomepage: cask.homepage ?? null,
          homebrewCaskMatchedAt: now,
          updatedAt: now,
        })
        .where(eq(discoveredApps.id, dapp.id));
      bundleIdMatches++;
      matchedCaskTokens.add(cask.token);
    } catch (e) {
      console.error(`Failed to update discovered app ${dapp.id}:`, e);
      errors++;
    }
  }

  // Store sync stats
  await env.CONFIG_KV.put(LAST_SYNC_KV_KEY, now);
  await env.CONFIG_KV.put(
    "cask-index-sync-stats",
    JSON.stringify({
      lastSyncAt: now,
      totalCasks: casks.length,
      bundleIdMatches,
      errors,
    }),
  );

  console.log(`Cask index sync complete: ${bundleIdMatches} bundle ID matches, ${errors} errors`);
}

/**
 * Check if a cask index sync is due (used by the scheduled handler).
 */
export async function isCaskSyncDue(env: Env): Promise<boolean> {
  const lastSync = await env.CONFIG_KV.get(LAST_SYNC_KV_KEY);
  if (!lastSync) return true;
  return Date.now() - new Date(lastSync).getTime() >= SYNC_INTERVAL_MS;
}
