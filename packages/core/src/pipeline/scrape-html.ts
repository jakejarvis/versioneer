import type { SourceRole, SourceType } from "@versioneer/schemas/sources";
import * as cheerio from "cheerio";

import { parseGitHubRepoUrl } from "../validation/github-url";
import { readResponseTextLimited } from "./response-body";

export type CheerioDoc = cheerio.CheerioAPI;
export interface HomepageSourceCandidate {
  sourceType: SourceType;
  url: string;
  role: SourceRole;
  parserKey: string;
  reason: string;
}

const MAX_HTML_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Fetches a URL and returns a parsed cheerio document.
 * Returns null on network errors, non-2xx responses, or timeouts.
 */
export async function fetchAndParse(
  url: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<CheerioDoc | null> {
  const { timeoutMs = 10_000, headers = {} } = options;
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      headers: {
        "User-Agent": "Versioneer/1.0 (https://versioneer.app)",
        Accept: "text/html, application/xhtml+xml",
        ...headers,
      },
    });
    if (!response.ok) return null;
    const { text: html } = await readResponseTextLimited(response, MAX_HTML_BODY_BYTES);
    return cheerio.load(html);
  } catch {
    return null;
  }
}

/**
 * Extracts the best icon/logo URL from a parsed HTML page.
 *
 * Priority order:
 * 1. apple-touch-icon (highest quality, typically 180x180+)
 * 2. og:image (social preview, usually large)
 * 3. link[rel="icon"] with largest size
 * 4. /favicon.ico fallback
 */
export function extractIconUrl(doc: CheerioDoc, baseUrl: string): string | null {
  // 1. apple-touch-icon (prefer largest)
  const touchIcons = doc('link[rel="apple-touch-icon"], link[rel="apple-touch-icon-precomposed"]');
  if (touchIcons.length > 0) {
    let bestHref: string | null = null;
    let bestSize = 0;
    touchIcons.each((_, el) => {
      const href = doc(el).attr("href");
      if (!href) return;
      const sizes = doc(el).attr("sizes") ?? "";
      const size = parseInt(sizes.split("x")[0] ?? "0", 10);
      if (size >= bestSize) {
        bestSize = size;
        bestHref = href;
      }
    });
    if (bestHref) return resolveUrl(bestHref, baseUrl);
  }

  // 2. og:image
  const ogImage =
    doc('meta[property="og:image"]').attr("content") ??
    doc('meta[name="og:image"]').attr("content");
  if (ogImage) return resolveUrl(ogImage, baseUrl);

  // 3. link[rel="icon"] — prefer largest, SVG, or PNG
  const icons = doc('link[rel="icon"], link[rel="shortcut icon"]');
  if (icons.length > 0) {
    let bestHref: string | null = null;
    let bestSize = 0;
    icons.each((_, el) => {
      const href = doc(el).attr("href");
      if (!href) return;
      const sizes = doc(el).attr("sizes") ?? "";
      const size = parseInt(sizes.split("x")[0] ?? "0", 10);
      const type = doc(el).attr("type") ?? "";
      // Prefer SVG and PNG over ICO
      const typeBonus = type.includes("svg") ? 10000 : type.includes("png") ? 1000 : 0;
      if (size + typeBonus >= bestSize) {
        bestSize = size + typeBonus;
        bestHref = href;
      }
    });
    if (bestHref) return resolveUrl(bestHref, baseUrl);
  }

  // 4. /favicon.ico fallback
  return resolveUrl("/favicon.ico", baseUrl);
}

/**
 * Extracts Open Graph meta tags from a parsed HTML document.
 * Returns a record of property → content, e.g. { "og:title": "App Name" }.
 */
export function extractOpenGraph(doc: CheerioDoc): Record<string, string> {
  const result: Record<string, string> = {};
  doc('meta[property^="og:"]').each((_, el) => {
    const prop = doc(el).attr("property");
    const content = doc(el).attr("content");
    if (prop && content) result[prop] = content;
  });
  return result;
}

/**
 * Extracts <link> tags matching a specific `rel` value.
 * Useful for finding stylesheets, icons, feeds, etc.
 */
export function extractLinks(
  doc: CheerioDoc,
  rel: string,
): { href: string; type?: string; sizes?: string }[] {
  const results: { href: string; type?: string; sizes?: string }[] = [];
  doc(`link[rel="${rel}"]`).each((_, el) => {
    const href = doc(el).attr("href");
    if (!href) return;
    results.push({
      href,
      type: doc(el).attr("type") ?? undefined,
      sizes: doc(el).attr("sizes") ?? undefined,
    });
  });
  return results;
}

/**
 * Extracts the page title from <title> or og:title.
 */
export function extractTitle(doc: CheerioDoc): string | null {
  const ogTitle = doc('meta[property="og:title"]').attr("content");
  if (ogTitle) return ogTitle.trim();
  const title = doc("title").first().text();
  return title ? title.trim() : null;
}

export function discoverHomepageSourceCandidates(
  doc: CheerioDoc,
  baseUrl: string,
): HomepageSourceCandidate[] {
  const candidates = new Map<string, HomepageSourceCandidate>();
  const base = safeParseUrl(baseUrl);
  if (!base) return [];

  const addCandidate = (candidate: HomepageSourceCandidate) => {
    const key = `${candidate.sourceType}:${candidate.url}`;
    if (!candidates.has(key)) {
      candidates.set(key, candidate);
    }
  };

  doc('link[rel~="alternate"][href]').each((_, element) => {
    const href = doc(element).attr("href");
    if (!href) return;
    const url = resolveUrl(href, baseUrl);
    const parsed = safeParseUrl(url);
    if (!parsed || parsed.origin !== base.origin) return;

    const type = (doc(element).attr("type") ?? "").toLowerCase();
    const pathname = parsed.pathname.toLowerCase();
    if (
      type.includes("rss") ||
      type.includes("atom") ||
      pathname.endsWith(".rss") ||
      pathname.endsWith(".atom")
    ) {
      addCandidate({
        sourceType: "rss_feed",
        url,
        role: "reference",
        parserKey: "rss_reference",
        reason: "homepage alternate feed link",
      });
      return;
    }

    if (type.includes("json") || pathname.endsWith(".json")) {
      addCandidate({
        sourceType: "json_feed",
        url,
        role: "reference",
        parserKey: "json_reference",
        reason: "homepage alternate JSON feed",
      });
    }
  });

  doc("a[href], link[href]").each((_, element) => {
    const href = doc(element).attr("href");
    if (!href) return;
    if (href.startsWith("mailto:") || href.startsWith("javascript:")) return;

    const url = resolveUrl(href, baseUrl);
    const parsed = safeParseUrl(url);
    if (!parsed) return;
    const pathname = parsed.pathname.toLowerCase();

    const ghParsed = parseGitHubRepoUrl(url);
    if (ghParsed) {
      addCandidate({
        sourceType: "github_releases",
        url: `https://github.com/${ghParsed.owner}/${ghParsed.repo}`,
        role: "authority",
        parserKey: "github_releases",
        reason: "homepage GitHub repository link",
      });
      return;
    }

    if (parsed.origin !== base.origin) return;

    if (pathname.endsWith("/latest-mac.yml") || pathname.endsWith("/latest.yml")) {
      addCandidate({
        sourceType: "electron_generic",
        url,
        role: "authority",
        parserKey: "electron_generic",
        reason: "homepage Electron update manifest",
      });
      return;
    }

    if (pathname.includes("appcast") || pathname.includes("sparkle")) {
      addCandidate({
        sourceType: "sparkle",
        url,
        role: "authority",
        parserKey: "sparkle",
        reason: "homepage Sparkle appcast link",
      });
      return;
    }

    if (
      pathname.endsWith(".rss") ||
      pathname.endsWith(".atom") ||
      pathname.endsWith("/feed") ||
      pathname.endsWith("/feed.xml") ||
      pathname.endsWith("/rss") ||
      pathname.endsWith("/rss.xml") ||
      pathname.endsWith("/atom.xml")
    ) {
      addCandidate({
        sourceType: "rss_feed",
        url,
        role: "reference",
        parserKey: "rss_reference",
        reason: "homepage RSS or Atom feed link",
      });
      return;
    }

    if (
      pathname.endsWith(".json") &&
      /(release|releases|update|updates|feed|downloads?)/.test(pathname)
    ) {
      addCandidate({
        sourceType: "json_feed",
        url,
        role: "reference",
        parserKey: "json_reference",
        reason: "homepage JSON update link",
      });
    }
  });

  return [...candidates.values()];
}

export async function fetchHomepageSourceCandidates(
  baseUrl: string,
  options: { timeoutMs?: number; headers?: Record<string, string> } = {},
): Promise<HomepageSourceCandidate[]> {
  const doc = await fetchAndParse(baseUrl, options);
  if (!doc) return [];
  return discoverHomepageSourceCandidates(doc, baseUrl);
}

export function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

function safeParseUrl(url: string): URL | null {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}
