import * as cheerio from "cheerio";

export type CheerioDoc = cheerio.CheerioAPI;

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
    const html = await response.text();
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

function resolveUrl(href: string, base: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}
