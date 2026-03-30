/** Convert any parseable date string (RFC 2822, ISO 8601, etc.) to ISO 8601. */
export function toISODate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}
