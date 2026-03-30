/** Format elapsed time between two ISO date strings for display. */
export function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "--";
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return "--";
  const ms = end - start;
  if (ms < 1000) return `${Math.max(0, ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60_000).toFixed(1)}m`;
}
