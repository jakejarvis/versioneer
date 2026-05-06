import type { SuggestionStatus } from "@versioneer/schemas/review";

export const REVIEW_APPROVAL_STALE_MS = 15 * 60 * 1000;

export const rejectableCatalogSuggestionStatuses = ["pending", "failed"] as const;

export interface CatalogSuggestionReviewState {
  status: SuggestionStatus;
  now: string;
  processingStartedAt?: string | null;
}

export function isCatalogSuggestionRejectableStatus(
  status: SuggestionStatus,
): status is (typeof rejectableCatalogSuggestionStatuses)[number] {
  return rejectableCatalogSuggestionStatuses.includes(
    status as (typeof rejectableCatalogSuggestionStatuses)[number],
  );
}

export function getCatalogSuggestionApprovalStaleBefore(now: string) {
  const nowMs = Date.parse(now);
  if (Number.isNaN(nowMs)) {
    return null;
  }

  return new Date(nowMs - REVIEW_APPROVAL_STALE_MS).toISOString();
}

export function isActionableCatalogSuggestionStatus(params: CatalogSuggestionReviewState) {
  return isCatalogSuggestionApprovalClaimable(params);
}

export function isAttentionCatalogSuggestionStatus(params: CatalogSuggestionReviewState) {
  return isCatalogSuggestionApprovalClaimable(params);
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

export function isCatalogSuggestionApprovalClaimable(params: CatalogSuggestionReviewState) {
  if (isCatalogSuggestionRejectableStatus(params.status)) {
    return true;
  }

  if (params.status !== "processing") {
    return false;
  }

  if (!params.processingStartedAt) {
    return true;
  }

  const staleBefore = getCatalogSuggestionApprovalStaleBefore(params.now);
  if (!staleBefore) {
    return false;
  }

  const staleBeforeMs = Date.parse(staleBefore);
  const startedAtMs = Date.parse(params.processingStartedAt);
  if (Number.isNaN(staleBeforeMs) || Number.isNaN(startedAtMs)) {
    return false;
  }

  return startedAtMs <= staleBeforeMs;
}
