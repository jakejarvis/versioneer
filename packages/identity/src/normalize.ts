/**
 * Normalize a string for fuzzy matching.
 * Strips a trailing .app bundle extension, lowercases, removes
 * non-alphanumeric, and collapses whitespace.
 */
export function normalizeName(name: string): string {
  return name
    .trim()
    .replace(/\.app$/i, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalize a bundle ID for comparison.
 */
export function normalizeBundleId(bundleId: string): string {
  return bundleId.toLowerCase().trim();
}
