import { parseVersion } from "./parse";

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
 * This strips leading 'v' and cleans whitespace but preserves
 * the human-readable format.
 */
export function displayVersion(raw: string): string {
  return raw.trim().replace(/^[vV]/, "");
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
