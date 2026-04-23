import { describe, expect, it } from "vite-plus/test";

import {
  REVIEW_APPROVAL_STALE_MS,
  getCatalogSuggestionApprovalLabel,
  getCatalogSuggestionApprovalResultMessage,
  getCatalogSuggestionRejectResultMessage,
  isActionableCatalogSuggestionStatus,
  isAttentionCatalogSuggestionStatus,
  isCatalogSuggestionApprovalClaimable,
} from "./review-lifecycle";

describe("review lifecycle helpers", () => {
  it("marks only pending and failed suggestions as actionable attention items", () => {
    expect(isActionableCatalogSuggestionStatus("pending")).toBe(true);
    expect(isActionableCatalogSuggestionStatus("failed")).toBe(true);
    expect(isActionableCatalogSuggestionStatus("processing")).toBe(false);
    expect(isActionableCatalogSuggestionStatus("approved")).toBe(false);
    expect(isAttentionCatalogSuggestionStatus("pending")).toBe(true);
    expect(isAttentionCatalogSuggestionStatus("failed")).toBe(true);
    expect(isAttentionCatalogSuggestionStatus("processing")).toBe(false);
  });

  it("uses retry-specific approval copy for failed suggestions", () => {
    expect(getCatalogSuggestionApprovalLabel("pending")).toBe("Approve");
    expect(getCatalogSuggestionApprovalLabel("failed")).toBe("Retry Approval");
    expect(getCatalogSuggestionApprovalResultMessage("processing")).toBe(
      "Suggestion is already processing",
    );
    expect(getCatalogSuggestionRejectResultMessage("approved")).toBe(
      "Suggestion was already approved",
    );
  });

  it("allows reclaiming stale processing approvals but not fresh ones", () => {
    const now = "2026-04-23T12:30:00.000Z";
    const staleStartedAt = new Date(Date.parse(now) - REVIEW_APPROVAL_STALE_MS).toISOString();
    const freshStartedAt = new Date(Date.parse(now) - REVIEW_APPROVAL_STALE_MS + 1).toISOString();

    expect(
      isCatalogSuggestionApprovalClaimable({
        status: "processing",
        now,
        processingStartedAt: staleStartedAt,
      }),
    ).toBe(true);
    expect(
      isCatalogSuggestionApprovalClaimable({
        status: "processing",
        now,
        processingStartedAt: freshStartedAt,
      }),
    ).toBe(false);
    expect(
      isCatalogSuggestionApprovalClaimable({
        status: "processing",
        now,
        processingStartedAt: null,
      }),
    ).toBe(true);
    expect(
      isCatalogSuggestionApprovalClaimable({
        status: "superseded",
        now,
      }),
    ).toBe(false);
  });
});
