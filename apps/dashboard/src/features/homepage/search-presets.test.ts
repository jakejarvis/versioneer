import { describe, expect, it } from "vite-plus/test";

import {
  appsSearch,
  atRiskSourceSearch,
  discoveredSearch,
  failedEnrichmentSearch,
  feedbackSearch,
  pendingEnrichmentSearch,
  releasesSearch,
  reviewSearch,
} from "./search-presets";

describe("homepage search presets", () => {
  it("keeps the existing review and app navigation defaults", () => {
    expect(reviewSearch).toEqual({
      page: 1,
      pageSize: 25,
      status: "pending",
      queueType: "all",
    });
    expect(appsSearch).toEqual({
      page: 1,
      pageSize: 25,
      search: "",
      status: "all",
    });
  });

  it("derives enrichment presets from the shared discovered-app defaults", () => {
    expect(discoveredSearch).toEqual({
      page: 1,
      pageSize: 25,
      status: "pending",
      enrichmentStatus: "all",
      sortBy: "confidenceScore",
      sortDir: "desc",
    });
    expect(pendingEnrichmentSearch).toEqual({
      ...discoveredSearch,
      enrichmentStatus: "pending",
    });
    expect(failedEnrichmentSearch).toEqual({
      ...discoveredSearch,
      enrichmentStatus: "failed",
    });
  });

  it("preserves source, feedback, and release navigation defaults", () => {
    expect(feedbackSearch).toEqual({
      page: 1,
      pageSize: 25,
      status: "new",
      type: "all",
    });
    expect(atRiskSourceSearch).toEqual({
      page: 1,
      pageSize: 25,
      status: "at_risk",
      type: "all",
    });
    expect(releasesSearch).toEqual({
      page: 1,
      pageSize: 25,
      channel: "all",
      status: "active",
      sortBy: "createdAt",
      sortDir: "desc",
    });
  });
});
