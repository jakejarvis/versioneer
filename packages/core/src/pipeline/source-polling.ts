export function computeNextPollAt(params: {
  baseTime: string | Date | null | undefined;
  pollIntervalMinutes: number;
  now?: string | Date;
}): string {
  const nowMs = params.now ? new Date(params.now).getTime() : Date.now();
  const baseMs = params.baseTime ? new Date(params.baseTime).getTime() : nowMs;
  const safeBaseMs = Number.isFinite(baseMs) ? baseMs : nowMs;
  const intervalMs = Math.max(1, params.pollIntervalMinutes) * 60 * 1000;
  return new Date(safeBaseMs + intervalMs).toISOString();
}

export function initialNextPollAt(params: {
  status: string;
  pollIntervalMinutes: number;
  now?: string | Date;
}): string | null {
  if (params.status !== "active") return null;
  return new Date(params.now ?? Date.now()).toISOString();
}
