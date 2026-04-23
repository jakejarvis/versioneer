export const reviewSearch = { page: 1, pageSize: 25, status: "pending", queueType: "all" } as const;

export const appsSearch = { page: 1, pageSize: 25, search: "", status: "all" } as const;

export const discoveredSearch = {
  page: 1,
  pageSize: 25,
  status: "pending",
  enrichmentStatus: "all",
  sortBy: "confidenceScore",
  sortDir: "desc",
} as const;

export const pendingEnrichmentSearch = {
  ...discoveredSearch,
  enrichmentStatus: "pending",
} as const;

export const failedEnrichmentSearch = {
  ...discoveredSearch,
  enrichmentStatus: "failed",
} as const;

export const feedbackSearch = { page: 1, pageSize: 25, status: "new", type: "all" } as const;

export const atRiskSourceSearch = {
  page: 1,
  pageSize: 25,
  status: "at_risk",
  type: "all",
} as const;

export const releasesSearch = {
  page: 1,
  pageSize: 25,
  channel: "all",
  status: "active",
  sortBy: "createdAt",
  sortDir: "desc",
} as const;
