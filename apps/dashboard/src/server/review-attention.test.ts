import { describe, expect, it } from "vite-plus/test";

import {
  compareCatalogSuggestionAttention,
  getCatalogSuggestionAttentionRank,
  isCatalogSuggestionAttentionCandidate,
} from "./review-attention";

const TEST_NOW_ISO = "2026-04-23T12:30:00.000Z";
const TEST_STALE_STARTED_AT = "2026-04-23T12:15:00.000Z";
const TEST_FRESH_STARTED_AT = "2026-04-23T12:15:00.001Z";

describe("catalog suggestion attention helpers", () => {
  it("treats stale-or-null processing suggestions as attention candidates", () => {
    expect(isCatalogSuggestionAttentionCandidate({ status: "pending", now: TEST_NOW_ISO })).toBe(
      true,
    );
    expect(isCatalogSuggestionAttentionCandidate({ status: "failed", now: TEST_NOW_ISO })).toBe(
      true,
    );
    expect(
      isCatalogSuggestionAttentionCandidate({
        status: "processing",
        now: TEST_NOW_ISO,
        processingStartedAt: TEST_STALE_STARTED_AT,
      }),
    ).toBe(true);
    expect(
      isCatalogSuggestionAttentionCandidate({
        status: "processing",
        now: TEST_NOW_ISO,
        processingStartedAt: null,
      }),
    ).toBe(true);
    expect(
      isCatalogSuggestionAttentionCandidate({
        status: "processing",
        now: TEST_NOW_ISO,
        processingStartedAt: TEST_FRESH_STARTED_AT,
      }),
    ).toBe(false);
  });

  it("ranks failed suggestions ahead of stale processing and pending items", () => {
    expect(getCatalogSuggestionAttentionRank("failed")).toBe(0);
    expect(getCatalogSuggestionAttentionRank("processing")).toBe(1);
    expect(getCatalogSuggestionAttentionRank("pending")).toBe(2);

    const items = [
      {
        id: "pending",
        status: "pending" as const,
        firstSeenAt: "2026-04-23T11:00:00.000Z",
        createdAt: "2026-04-23T11:00:00.000Z",
      },
      {
        id: "processing",
        status: "processing" as const,
        firstSeenAt: "2026-04-23T10:00:00.000Z",
        createdAt: "2026-04-23T10:00:00.000Z",
      },
      {
        id: "failed",
        status: "failed" as const,
        firstSeenAt: "2026-04-23T12:00:00.000Z",
        createdAt: "2026-04-23T12:00:00.000Z",
      },
    ];

    items.sort(compareCatalogSuggestionAttention);

    expect(items.map((item) => item.id)).toEqual(["failed", "processing", "pending"]);
    expect(items[1]?.status).toBe("processing");
  });
});
