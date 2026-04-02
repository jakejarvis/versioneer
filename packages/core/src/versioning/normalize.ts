import { parseVersion, PRE_RELEASE_TAGS } from "./parse";

/**
 * Normalize a raw version string to a comparable form.
 * Returns the normalized string or the raw string if parsing fails.
 */
export function normalizeVersion(raw: string): string {
  const parsed = parseVersion(raw);
  return parsed.valid ? parsed.normalized : raw;
}

/**
 * Extract a display-friendly version from a raw string.
 * Strips leading 'v', name prefixes (e.g. "release-", "XQuartz-"), and
 * cleans whitespace while preserving the human-readable format.
 */
export function displayVersion(raw: string): string {
  let s = raw.trim().replace(/^[vV]/, "");

  // Strip leading name prefix (e.g. "release-3.5.7", "XQuartz-2.8.6_beta4").
  // Keep the prefix when it is a known pre-release tag ("beta-1.0").
  const m = s.match(/^([a-zA-Z]+)[-_](?=\d)/);
  if (m && !(m[1]!.toLowerCase() in PRE_RELEASE_TAGS)) {
    s = s.slice(m[0]!.length);
  }

  return s;
}

/**
 * Determine if a version string looks like a pre-release.
 */
export function isPreRelease(raw: string): boolean {
  const parsed = parseVersion(raw);
  return parsed.preReleaseTag !== null;
}

/**
 * Infer channel from version string.
 */
export function inferChannel(raw: string): string {
  const parsed = parseVersion(raw);
  if (!parsed.preReleaseTag) return "stable";
  const tag = parsed.preReleaseTag;
  if (tag === "nightly" || tag === "dev") return "nightly";
  return "beta";
}
