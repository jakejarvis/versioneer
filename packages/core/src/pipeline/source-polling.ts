import { toEpochMs } from "../dates";

function dateLikeEpochMs(value: string | Date | null | undefined): number | null {
  if (!value) return null;
  const ms = value instanceof Date ? value.getTime() : toEpochMs(value);
  return Number.isFinite(ms) ? ms : null;
}

export function computeNextPollAt(params: {
  baseTime: string | Date | null | undefined;
  pollIntervalMinutes: number;
  now?: string | Date;
}): string {
  const nowMs = dateLikeEpochMs(params.now) ?? Date.now();
  const baseMs = dateLikeEpochMs(params.baseTime) ?? nowMs;
  const intervalMs = Math.max(1, params.pollIntervalMinutes) * 60 * 1000;
  return new Date(baseMs + intervalMs).toISOString();
}

export function initialNextPollAt(params: {
  status: string;
  pollIntervalMinutes: number;
  now?: string | Date;
}): string | null {
  if (params.status !== "active") return null;
  const nowMs = dateLikeEpochMs(params.now) ?? Date.now();
  return new Date(nowMs).toISOString();
}
