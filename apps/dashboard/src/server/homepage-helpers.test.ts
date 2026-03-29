import { describe, expect, it } from "vitest";

import type { AppSummary } from "@/api/types";

import { buildAtRiskSources, type AtRiskSourceCandidate } from "./homepage-helpers";

const appSummaries = new Map<string, AppSummary>([
  [
    "app_alpha",
    {
      id: "app_alpha",
      slug: "alpha",
      canonicalName: "Alpha",
      vendorName: "Alpha Inc.",
      iconR2Key: null,
      status: "public",
    },
  ],
]);

function candidate(overrides: Partial<AtRiskSourceCandidate>): AtRiskSourceCandidate {
  return {
    id: "src_default",
    appId: "app_alpha",
    sourceType: "sparkle",
    label: "Default Source",
    baseUrl: null,
    configJson: null,
    parserKey: "sparkle",
    channel: null,
    pollIntervalMinutes: 60,
    reviewStatus: "approved",
    role: "authority",
    ordinal: 0,
    status: "active",
    lastSuccessAt: null,
    lastFailureAt: null,
    lastFetchedAt: "2026-03-29T10:00:00.000Z",
    createdAt: "2026-03-28T10:00:00.000Z",
    updatedAt: "2026-03-29T10:00:00.000Z",
    ...overrides,
  };
}

describe("buildAtRiskSources", () => {
  it("ranks error sources ahead of overdue sources and sorts each bucket correctly", () => {
    const items = buildAtRiskSources(
      [
        candidate({
          id: "src_error_recent",
          status: "error",
          lastFailureAt: "2026-03-29T11:45:00.000Z",
        }),
        candidate({
          id: "src_overdue_large",
          lastFetchedAt: "2026-03-29T06:00:00.000Z",
        }),
        candidate({
          id: "src_error_older",
          status: "error",
          lastFailureAt: "2026-03-29T09:30:00.000Z",
        }),
        candidate({
          id: "src_overdue_small",
          lastFetchedAt: "2026-03-29T10:45:00.000Z",
        }),
      ],
      appSummaries,
      new Date("2026-03-29T12:00:00.000Z"),
    );

    expect(items.map((item) => item.id)).toEqual([
      "src_error_recent",
      "src_error_older",
      "src_overdue_large",
      "src_overdue_small",
    ]);
    expect(items[0]?.overdueMinutes).toBeNull();
    expect(items[2]?.overdueMinutes).toBe(300);
    expect(items[3]?.overdueMinutes).toBe(15);
  });

  it("treats active sources with no last fetch as overdue using createdAt", () => {
    const [item] = buildAtRiskSources(
      [
        candidate({
          id: "src_never_fetched",
          lastFetchedAt: null,
          createdAt: "2026-03-29T08:30:00.000Z",
        }),
      ],
      appSummaries,
      new Date("2026-03-29T12:00:00.000Z"),
    );

    expect(item).toMatchObject({
      id: "src_never_fetched",
      risk: "overdue",
      overdueMinutes: 150,
    });
  });

  it("applies the requested limit after sorting", () => {
    const items = buildAtRiskSources(
      [
        candidate({ id: "src_error", status: "error", lastFailureAt: "2026-03-29T11:45:00.000Z" }),
        candidate({ id: "src_overdue_1", lastFetchedAt: "2026-03-29T07:00:00.000Z" }),
        candidate({ id: "src_overdue_2", lastFetchedAt: "2026-03-29T08:00:00.000Z" }),
      ],
      appSummaries,
      new Date("2026-03-29T12:00:00.000Z"),
      2,
    );

    expect(items.map((item) => item.id)).toEqual(["src_error", "src_overdue_1"]);
  });
});
