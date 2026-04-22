import { describe, expect, it } from "vite-plus/test";

import type { AppSummary } from "@/lib/types";

import {
  buildAppSourceHealth,
  buildAtRiskSources,
  OVERDUE_GRACE_MULTIPLIER,
  type AtRiskSourceCandidate,
} from "./homepage-helpers";

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
    // poll=60, grace=60*1.5=90 min. now=12:00.
    // src_overdue_large fetched at 06:00 → 360 min elapsed − 90 grace = 270 overdue
    // src_overdue_small fetched at 10:00 → 120 min elapsed − 90 grace = 30 overdue
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
          lastFetchedAt: "2026-03-29T10:00:00.000Z",
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
    expect(items[2]?.overdueMinutes).toBe(270);
    expect(items[3]?.overdueMinutes).toBe(30);
  });

  it("treats active sources with no last fetch as overdue using createdAt", () => {
    // poll=60, grace=90 min. created at 08:30, now=12:00 → 210 min − 90 grace = 120 overdue
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
      overdueMinutes: 120,
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

  it("does not flag a source as overdue during the grace period", () => {
    // poll=60, grace=90 min. Fetched at 11:00, now=12:00 → only 60 min elapsed, still within grace.
    const items = buildAtRiskSources(
      [
        candidate({
          id: "src_within_grace",
          lastFetchedAt: "2026-03-29T11:00:00.000Z",
        }),
      ],
      appSummaries,
      new Date("2026-03-29T12:00:00.000Z"),
    );

    expect(items[0]?.overdueMinutes).toBe(0);
  });

  it("uses OVERDUE_GRACE_MULTIPLIER for the grace window", () => {
    // Sanity check: with 1.5x, a 60-min interval becomes a 90-min threshold.
    // Fetched at 10:29, now=12:00 → 91 min elapsed − 90 grace = 1 min overdue.
    const [item] = buildAtRiskSources(
      [
        candidate({
          id: "src_just_past_grace",
          lastFetchedAt: "2026-03-29T10:29:00.000Z",
        }),
      ],
      appSummaries,
      new Date("2026-03-29T12:00:00.000Z"),
    );

    expect(OVERDUE_GRACE_MULTIPLIER).toBe(1.5);
    expect(item?.overdueMinutes).toBe(1);
  });
});

describe("buildAppSourceHealth", () => {
  const now = new Date("2026-03-29T12:00:00.000Z");

  it("returns no_sources when an app has no source rows", () => {
    expect(buildAppSourceHealth([], now)).toEqual({
      total: 0,
      active: 0,
      error: 0,
      stale: 0,
      disabled: 0,
      latestFetchAt: null,
      latestSuccessAt: null,
      latestFailureAt: null,
      status: "no_sources",
    });
  });

  it("classifies active sources inside the grace window as fresh", () => {
    const health = buildAppSourceHealth(
      [
        candidate({
          id: "src_fresh",
          lastFetchedAt: "2026-03-29T11:00:00.000Z",
          lastSuccessAt: "2026-03-29T11:00:10.000Z",
        }),
      ],
      now,
    );

    expect(health).toMatchObject({
      total: 1,
      active: 1,
      stale: 0,
      error: 0,
      status: "fresh",
      latestFetchAt: "2026-03-29T11:00:00.000Z",
      latestSuccessAt: "2026-03-29T11:00:10.000Z",
    });
  });

  it("classifies overdue active sources as attention", () => {
    const health = buildAppSourceHealth(
      [
        candidate({
          id: "src_stale",
          lastFetchedAt: "2026-03-29T10:29:00.000Z",
        }),
      ],
      now,
    );

    expect(health).toMatchObject({
      total: 1,
      active: 1,
      stale: 1,
      status: "attention",
    });
  });

  it("classifies error sources as attention and keeps latest failure", () => {
    const health = buildAppSourceHealth(
      [
        candidate({
          id: "src_error_old",
          status: "error",
          lastFailureAt: "2026-03-29T09:00:00.000Z",
        }),
        candidate({
          id: "src_error_new",
          status: "error",
          lastFailureAt: "2026-03-29T11:30:00.000Z",
        }),
      ],
      now,
    );

    expect(health).toMatchObject({
      total: 2,
      error: 2,
      status: "attention",
      latestFailureAt: "2026-03-29T11:30:00.000Z",
    });
  });

  it("classifies disabled-only source sets as unknown", () => {
    const health = buildAppSourceHealth(
      [
        candidate({
          id: "src_disabled",
          status: "disabled",
          lastFetchedAt: "2026-03-29T11:45:00.000Z",
        }),
      ],
      now,
    );

    expect(health).toMatchObject({
      total: 1,
      active: 0,
      disabled: 1,
      status: "unknown",
    });
  });
});
