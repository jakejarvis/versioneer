import { initialNextPollAt } from "@versioneer/core/pipeline";
import {
  defaultPollIntervalForSourceType,
  type SourceRole,
  type SourceStatus,
  type SourceType,
} from "@versioneer/schemas/sources";

export function buildApprovedSuggestionSourceInsert(params: {
  id: string;
  appId: string;
  sourceType: SourceType;
  label: string | null;
  baseUrl: string | null;
  parserKey: string;
  channel: string | null;
  role: SourceRole;
  status: Extract<SourceStatus, "active" | "disabled">;
  reviewer: string;
  now: string;
}) {
  const pollIntervalMinutes = defaultPollIntervalForSourceType(params.sourceType);

  return {
    id: params.id,
    appId: params.appId,
    sourceType: params.sourceType,
    label: params.label,
    baseUrl: params.baseUrl,
    configJson: null,
    parserKey: params.parserKey,
    channel: params.channel,
    pollIntervalMinutes,
    reviewStatus: "approved" as const,
    role: params.role,
    status: params.status,
    nextPollAt: initialNextPollAt({
      status: params.status,
      pollIntervalMinutes,
      now: params.now,
    }),
    discoveredVia: "catalog_suggestion",
    approvedAt: params.now,
    reviewedAt: params.now,
    reviewedBy: params.reviewer,
    createdAt: params.now,
    updatedAt: params.now,
  };
}
