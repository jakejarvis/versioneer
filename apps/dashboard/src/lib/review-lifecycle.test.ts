import { describe, expect, it } from "vite-plus/test";

import {
  REVIEW_APPROVAL_STALE_MS,
  getCatalogSuggestionApprovalLabel,
  getCatalogSuggestionApprovalResultMessage,
  getCatalogSuggestionRejectResultMessage,
  isActionableCatalogSuggestionStatus,
  isAttentionCatalogSuggestionStatus,
  isCatalogSuggestionApprovalClaimable,
  isCatalogSuggestionRejectableStatus,
} from "./review-lifecycle";

describe("review lifecycle helpers", () => {
  it("marks stale-or-null processing suggestions as actionable attention items", () => {
    const now = "2026-04-23T12:30:00.000Z";
    const staleStartedAt = new Date(Date.parse(now) - REVIEW_APPROVAL_STALE_MS).toISOString();
    const freshStartedAt = new Date(Date.parse(now) - REVIEW_APPROVAL_STALE_MS + 1).toISOString();

    expect(isActionableCatalogSuggestionStatus({ status: "pending", now })).toBe(true);
    expect(isActionableCatalogSuggestionStatus({ status: "failed", now })).toBe(true);
    expect(
      isActionableCatalogSuggestionStatus({
        status: "processing",
        now,
        processingStartedAt: staleStartedAt,
      }),
    ).toBe(true);
    expect(
      isActionableCatalogSuggestionStatus({
        status: "processing",
        now,
        processingStartedAt: null,
      }),
    ).toBe(true);
    expect(
      isActionableCatalogSuggestionStatus({
        status: "processing",
        now,
        processingStartedAt: freshStartedAt,
      }),
    ).toBe(false);
    expect(isActionableCatalogSuggestionStatus({ status: "approved", now })).toBe(false);

    expect(isAttentionCatalogSuggestionStatus({ status: "pending", now })).toBe(true);
    expect(isAttentionCatalogSuggestionStatus({ status: "failed", now })).toBe(true);
    expect(
      isAttentionCatalogSuggestionStatus({
        status: "processing",
        now,
        processingStartedAt: staleStartedAt,
      }),
    ).toBe(true);
    expect(
      isAttentionCatalogSuggestionStatus({
        status: "processing",
        now,
        processingStartedAt: freshStartedAt,
      }),
    ).toBe(false);
  });

  it("keeps rejectability limited to pending and failed suggestions", () => {
    expect(isCatalogSuggestionRejectableStatus("pending")).toBe(true);
    expect(isCatalogSuggestionRejectableStatus("failed")).toBe(true);
    expect(isCatalogSuggestionRejectableStatus("processing")).toBe(false);
    expect(isCatalogSuggestionRejectableStatus("approved")).toBe(false);
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
