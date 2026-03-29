import type { AppSummary, AtRiskSourceItem, Source } from "@/api/types";

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
  return Math.max(minutesSinceBase - source.pollIntervalMinutes, 0);
}

export function buildAtRiskSources(
  sources: AtRiskSourceCandidate[],
  appSummaries: Map<string, AppSummary>,
  now = new Date(),
  limit = 8,
): AtRiskSourceItem[] {
  return sources
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
        const leftFailure = left.lastFailureAt ? new Date(left.lastFailureAt).getTime() : 0;
        const rightFailure = right.lastFailureAt ? new Date(right.lastFailureAt).getTime() : 0;
        return rightFailure - leftFailure;
      }

      return (right.overdueMinutes ?? 0) - (left.overdueMinutes ?? 0);
    })
    .slice(0, limit);
}
