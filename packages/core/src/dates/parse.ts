/** Convert any parseable date string (RFC 2822, ISO 8601, etc.) to ISO 8601. */
export function toISODate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const value = dateStr.trim();
  if (!looksLikeSupportedDate(value)) return null;
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

const ISO_DATE_RE =
  /^(\d{4})-(\d{2})-(\d{2})(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:?\d{2}))?$/i;
const RFC_2822_RE =
  /^(?:(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s*)?(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{4})\s+\d{2}:\d{2}(?::\d{2})?\s+(?:[+-]\d{4}|GMT|UTC)$/i;

const MONTH_INDEX_BY_NAME = new Map([
  ["jan", 1],
  ["feb", 2],
  ["mar", 3],
  ["apr", 4],
  ["may", 5],
  ["jun", 6],
  ["jul", 7],
  ["aug", 8],
  ["sep", 9],
  ["oct", 10],
  ["nov", 11],
  ["dec", 12],
]);

function looksLikeSupportedDate(value: string): boolean {
  const iso = ISO_DATE_RE.exec(value);
  if (iso) {
    return isValidCalendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  }
  const rfc2822 = RFC_2822_RE.exec(value);
  if (!rfc2822) return false;
  const month = MONTH_INDEX_BY_NAME.get(rfc2822[2]!.toLowerCase());
  return month !== undefined && isValidCalendarDate(Number(rfc2822[3]), month, Number(rfc2822[1]));
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
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
