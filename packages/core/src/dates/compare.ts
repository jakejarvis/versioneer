import { toISODate } from "./parse";

/** Parse an ISO date string to epoch milliseconds. Returns null if unparseable. */
export function toEpochMs(dateStr: string | null | undefined): number | null {
  const iso = toISODate(dateStr);
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/** Milliseconds elapsed since the given ISO date string. Returns null if invalid. */
export function msElapsedSince(
  dateStr: string | null | undefined,
  now = Date.now(),
): number | null {
  const ms = toEpochMs(dateStr);
  return ms === null ? null : now - ms;
}

/** Compare two ISO date strings for descending sort. Invalid dates sort to end. */
export function compareDatesDesc(
  a: string | null | undefined,
  b: string | null | undefined,
): number {
  const aMs = toEpochMs(a) ?? 0;
  const bMs = toEpochMs(b) ?? 0;
  return bMs - aMs;
}

/** Duration in ms between two ISO date strings. Null if either is invalid. */
export function durationMs(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  const s = toEpochMs(start);
  const e = toEpochMs(end);
  if (s === null || e === null) return null;
  return e - s;
}
