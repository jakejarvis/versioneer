/** Convert any parseable date string (RFC 2822, ISO 8601, etc.) to ISO 8601. */
export function toISODate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

/**
 * Resolve the `releasedAt` value for a new release.
 *
 * Uses the parser-provided date when available. Otherwise infers `now` for
 * releases discovered on subsequent fetches (the release just appeared), but
 * leaves the date null during the initial fetch (bootstrap) since those
 * releases pre-date our tracking.
 */
export function inferReleasedAt(
  parsedPublishedAt: string | undefined | null,
  isInitialFetch: boolean,
  now: string,
): string | null {
  return toISODate(parsedPublishedAt) ?? (isInitialFetch ? null : now);
}
