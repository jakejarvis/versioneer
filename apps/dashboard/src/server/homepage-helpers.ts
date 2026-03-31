import { toEpochMs } from "@versioneer/core/dates";
import { sources } from "@versioneer/db";
import { sql } from "drizzle-orm";

import type { AppSummary, AtRiskSourceItem, Source } from "@/api/types";

/**
 * Sources aren't flagged as stale/overdue until this multiple of their
 * poll interval has elapsed, giving the worker headroom to finish the fetch.
 */
export const OVERDUE_GRACE_MULTIPLIER = 1.5;

/** Active source that has missed its poll interval (with grace). */
export const staleSourceCondition = sql`
  ${sources.status} = 'active'
  and (
    ${sources.lastFetchedAt} is null
    or datetime(${sources.lastFetchedAt}, '+' || cast(${sources.pollIntervalMinutes} * ${OVERDUE_GRACE_MULTIPLIER} as integer) || ' minutes') <= datetime('now')
  )
`;

/** Error sources OR active sources past their grace window. */
export const atRiskSourceCondition = sql`
  ${sources.status} = 'error'
  or (
    ${sources.status} = 'active'
    and (
      ${sources.lastFetchedAt} is null
      or datetime(${sources.lastFetchedAt}, '+' || cast(${sources.pollIntervalMinutes} * ${OVERDUE_GRACE_MULTIPLIER} as integer) || ' minutes') <= datetime('now')
    )
  )
`;

export interface AtRiskSourceCandidate {
  id: string;
  appId: string;
  sourceType: Source["sourceType"];
  label: string | null;
  baseUrl: string | null;
  configJson: string | null;
  parserKey: string;
  channel: string | null;
  pollIntervalMinutes: number;
  reviewStatus: Source["reviewStatus"];
  role: Source["role"];
  ordinal: number;
  status: Source["status"];
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

function computeOverdueMinutes(source: AtRiskSourceCandidate, now: Date): number | null {
  if (source.status !== "active") {
    return null;
  }

  const baseTimestamp = source.lastFetchedAt ?? source.createdAt;
  const baseTime = new Date(baseTimestamp).getTime();

  if (Number.isNaN(baseTime)) {
    return null;
  }

  const minutesSinceBase = Math.floor((now.getTime() - baseTime) / 60_000);
  const gracedInterval = Math.floor(source.pollIntervalMinutes * OVERDUE_GRACE_MULTIPLIER);
  return Math.max(minutesSinceBase - gracedInterval, 0);
}

export function buildAtRiskSources(
  candidates: AtRiskSourceCandidate[],
  appSummaries: Map<string, AppSummary>,
  now = new Date(),
  limit = 8,
): AtRiskSourceItem[] {
  return candidates
    .map((source) => {
      const overdueMinutes = computeOverdueMinutes(source, now);
      const risk = source.status === "error" ? "error" : "overdue";

      return {
        ...source,
        app: appSummaries.get(source.appId) ?? null,
        risk,
        overdueMinutes: risk === "overdue" ? overdueMinutes : null,
      } satisfies AtRiskSourceItem;
    })
    .sort((left, right) => {
      if (left.risk !== right.risk) {
        return left.risk === "error" ? -1 : 1;
      }

      if (left.risk === "error" && right.risk === "error") {
        const leftFailure = toEpochMs(left.lastFailureAt) ?? 0;
        const rightFailure = toEpochMs(right.lastFailureAt) ?? 0;
        return rightFailure - leftFailure;
      }

      return (right.overdueMinutes ?? 0) - (left.overdueMinutes ?? 0);
    })
    .slice(0, limit);
}
