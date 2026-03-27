import { describe, expect, it } from "vitest";

import { toAppSummary, toReleaseSummary, toSourceSummary } from "@/server/entity-summaries";

import { buildAppSortDescriptors, buildReviewQueueSortDescriptors } from "./list-helpers";

describe("buildAppSortDescriptors", () => {
  it("defaults to updatedAt descending", () => {
    expect(buildAppSortDescriptors()).toEqual([{ field: "updatedAt", dir: "desc" }]);
  });

  it("respects explicit sortable fields and direction", () => {
    expect(buildAppSortDescriptors("canonicalName", "asc")).toEqual([
      { field: "canonicalName", dir: "asc" },
    ]);
    expect(buildAppSortDescriptors("qualityScore", "desc")).toEqual([
      { field: "qualityScore", dir: "desc" },
    ]);
  });
});

describe("buildReviewQueueSortDescriptors", () => {
  it("defaults to priority then createdAt descending", () => {
    expect(buildReviewQueueSortDescriptors()).toEqual([
      { field: "priority", dir: "desc" },
      { field: "createdAt", dir: "desc" },
    ]);
  });

  it("adds stable fallback ordering for status and type sorts", () => {
    expect(buildReviewQueueSortDescriptors("status", "asc")).toEqual([
      { field: "status", dir: "asc" },
      { field: "priority", dir: "desc" },
      { field: "createdAt", dir: "desc" },
    ]);
    expect(buildReviewQueueSortDescriptors("reviewType", "desc")).toEqual([
      { field: "reviewType", dir: "desc" },
      { field: "priority", dir: "desc" },
      { field: "createdAt", dir: "desc" },
    ]);
  });
});

describe("entity summary shaping", () => {
  it("returns nested app, source, and release summaries for enriched list rows", () => {
    const app = {
      id: "app_test",
      slug: "test-app",
      canonicalName: "Test App",
      vendorName: "Versioneer",
      homepageUrl: null,
      status: "active",
      mergedIntoAppId: null,
      notes: null,
      verificationTier: "verified",
      qualityState: "green",
      qualityScore: 99,
      iconR2Key: "icons/test.png",
      lastReviewedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    } as Parameters<typeof toAppSummary>[0];
    const source = {
      id: "src_test",
      appId: app.id,
      sourceType: "sparkle",
      label: "Stable appcast",
      baseUrl: "https://example.com/appcast.xml",
      configJson: null,
      parserKey: "sparkle",
      pollIntervalMinutes: 60,
      status: "active",
      lastSuccessAt: null,
      lastFailureAt: null,
      lastFetchedAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    } as Parameters<typeof toSourceSummary>[0];
    const release = {
      id: "rel_test",
      appId: app.id,
      versionRaw: "1.2.3",
      versionNormalized: "1.2.3",
      buildNumber: null,
      channel: "stable",
      releasedAt: "2026-01-03T00:00:00.000Z",
      isPrerelease: false,
      sourceConfidence: 95,
      status: "active",
      releaseNotesHtml: null,
      createdAt: "2026-01-03T00:00:00.000Z",
      updatedAt: "2026-01-03T00:00:00.000Z",
    } as Parameters<typeof toReleaseSummary>[0];

    expect(toAppSummary(app)).toEqual({
      id: "app_test",
      slug: "test-app",
      canonicalName: "Test App",
      vendorName: "Versioneer",
      iconR2Key: "icons/test.png",
      status: "active",
    });

    expect(toSourceSummary(source, app)).toEqual({
      id: "src_test",
      sourceType: "sparkle",
      label: "Stable appcast",
      parserKey: "sparkle",
      status: "active",
      app: {
        id: "app_test",
        slug: "test-app",
        canonicalName: "Test App",
        vendorName: "Versioneer",
        iconR2Key: "icons/test.png",
        status: "active",
      },
    });

    expect(toReleaseSummary(release, app)).toEqual({
      id: "rel_test",
      versionRaw: "1.2.3",
      channel: "stable",
      status: "active",
      isPrerelease: false,
      releasedAt: "2026-01-03T00:00:00.000Z",
      app: {
        id: "app_test",
        slug: "test-app",
        canonicalName: "Test App",
        vendorName: "Versioneer",
        iconR2Key: "icons/test.png",
        status: "active",
      },
    });
  });
});
