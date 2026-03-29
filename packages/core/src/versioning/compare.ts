import { parseVersion } from "./parse";
import type { ParsedVersion, ComparisonResult } from "./types";

/**
 * Compare two parsed versions.
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): ComparisonResult {
  // Invalid versions sort last
  if (!a.valid && !b.valid) return 0;
  if (!a.valid) return -1;
  if (!b.valid) return 1;

  // Compare normalized strings lexicographically
  // This works because segments are zero-padded
  if (a.normalized < b.normalized) return -1;
  if (a.normalized > b.normalized) return 1;
  return 0;
}

/**
 * Compare two raw version strings.
 */
export function compareVersionStrings(a: string, b: string): ComparisonResult {
  return compareVersions(parseVersion(a), parseVersion(b));
}

/**
 * Check if version a is newer than version b.
 */
export function isNewer(a: string | ParsedVersion, b: string | ParsedVersion): boolean {
  const pa = typeof a === "string" ? parseVersion(a) : a;
  const pb = typeof b === "string" ? parseVersion(b) : b;
  return compareVersions(pa, pb) > 0;
}

/**
 * Sort version strings from oldest to newest.
 */
export function sortVersions(versions: string[]): string[] {
  return [...versions].sort(compareVersionStrings);
}

/**
 * Find the latest (highest) version from a list.
 */
export function latestVersion(versions: string[]): string | null {
  if (versions.length === 0) return null;
  return sortVersions(versions)[versions.length - 1]!;
}
