import { and, asc, eq, lte, or, sql } from "drizzle-orm";

import {
  getCatalogSuggestionApprovalStaleBefore,
  isAttentionCatalogSuggestionStatus,
  type CatalogSuggestionReviewState,
} from "@/lib/review-lifecycle";
import { catalogSuggestions } from "@versioneer/db";

function catalogSuggestionStaleProcessingCondition(now: string) {
  const staleBefore = getCatalogSuggestionApprovalStaleBefore(now);
  if (!staleBefore) {
    throw new Error(`Invalid review lifecycle timestamp: ${now}`);
  }

  return and(
    eq(catalogSuggestions.status, "processing"),
    or(
      sql`${catalogSuggestions.processingStartedAt} is null`,
      lte(catalogSuggestions.processingStartedAt, staleBefore),
    ),
  );
}

export function catalogSuggestionApprovalClaimableCondition(now: string) {
  return or(
    eq(catalogSuggestions.status, "pending"),
    eq(catalogSuggestions.status, "failed"),
    catalogSuggestionStaleProcessingCondition(now),
  );
}

export function catalogSuggestionAttentionCondition(now: string) {
  return catalogSuggestionApprovalClaimableCondition(now);
}

export function getCatalogSuggestionAttentionRank(status: CatalogSuggestionReviewState["status"]) {
  switch (status) {
    case "failed":
      return 0;
    case "processing":
      return 1;
    default:
      return 2;
  }
}

export function isCatalogSuggestionAttentionCandidate(params: CatalogSuggestionReviewState) {
  return isAttentionCatalogSuggestionStatus(params);
}

export function compareCatalogSuggestionAttention(
  left: Pick<CatalogSuggestionReviewState, "status"> & {
    firstSeenAt: string;
    createdAt: string;
  },
  right: Pick<CatalogSuggestionReviewState, "status"> & {
    firstSeenAt: string;
    createdAt: string;
  },
) {
  const rankDifference =
    getCatalogSuggestionAttentionRank(left.status) -
    getCatalogSuggestionAttentionRank(right.status);
  if (rankDifference !== 0) {
    return rankDifference;
  }

  const firstSeenDifference = Date.parse(left.firstSeenAt) - Date.parse(right.firstSeenAt);
  if (firstSeenDifference !== 0) {
    return firstSeenDifference;
  }

  return Date.parse(left.createdAt) - Date.parse(right.createdAt);
}

export function catalogSuggestionAttentionOrderBy() {
  return [
    sql`case
      when ${catalogSuggestions.status} = 'failed' then 0
      when ${catalogSuggestions.status} = 'processing' then 1
      else 2
    end`,
    asc(catalogSuggestions.firstSeenAt),
    asc(catalogSuggestions.createdAt),
  ] as const;
}
