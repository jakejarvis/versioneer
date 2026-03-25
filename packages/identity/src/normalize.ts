/**
 * Normalize a string for fuzzy matching.
 * Lowercases, removes non-alphanumeric, collapses whitespace.
 */
export function normalizeName(name: string): string {
  return name
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
