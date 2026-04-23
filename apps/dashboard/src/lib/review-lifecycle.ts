import type { SuggestionStatus } from "@versioneer/schemas/review";

export const REVIEW_APPROVAL_STALE_MS = 15 * 60 * 1000;

export const actionableCatalogSuggestionStatuses = ["pending", "failed"] as const;
export const attentionCatalogSuggestionStatuses = actionableCatalogSuggestionStatuses;

export function isActionableCatalogSuggestionStatus(
  status: SuggestionStatus,
): status is (typeof actionableCatalogSuggestionStatuses)[number] {
  return actionableCatalogSuggestionStatuses.includes(
    status as (typeof actionableCatalogSuggestionStatuses)[number],
  );
}

export function isAttentionCatalogSuggestionStatus(
  status: SuggestionStatus,
): status is (typeof attentionCatalogSuggestionStatuses)[number] {
  return attentionCatalogSuggestionStatuses.includes(
    status as (typeof attentionCatalogSuggestionStatuses)[number],
  );
}

export function getCatalogSuggestionApprovalLabel(status: SuggestionStatus) {
  return status === "failed" ? "Retry Approval" : "Approve";
}

export function getCatalogSuggestionApprovalResultMessage(status: SuggestionStatus) {
  switch (status) {
    case "approved":
      return "Suggestion approved";
    case "processing":
      return "Suggestion is already processing";
    case "failed":
      return "Suggestion remains failed";
    case "rejected":
      return "Suggestion was already rejected";
    case "superseded":
      return "Suggestion was superseded";
    case "pending":
      return "Suggestion is still pending";
  }

  return status;
}

export function getCatalogSuggestionRejectResultMessage(status: SuggestionStatus) {
  switch (status) {
    case "rejected":
      return "Suggestion rejected";
    case "processing":
      return "Suggestion is already processing";
    case "approved":
      return "Suggestion was already approved";
    case "superseded":
      return "Suggestion was superseded";
    case "failed":
      return "Suggestion remains failed";
    case "pending":
      return "Suggestion is still pending";
  }

  return status;
}

export function isCatalogSuggestionApprovalClaimable(params: {
  status: SuggestionStatus;
  now: string;
  processingStartedAt?: string | null;
}) {
  if (params.status === "pending" || params.status === "failed") {
    return true;
  }

  if (params.status !== "processing") {
    return false;
  }

  if (!params.processingStartedAt) {
    return true;
  }

  const nowMs = Date.parse(params.now);
  const startedAtMs = Date.parse(params.processingStartedAt);
  if (Number.isNaN(nowMs) || Number.isNaN(startedAtMs)) {
    return false;
  }

  return nowMs - startedAtMs >= REVIEW_APPROVAL_STALE_MS;
}
