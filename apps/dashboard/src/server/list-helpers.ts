export type SortDirection = "asc" | "desc";

export interface SortDescriptor {
  field: string;
  dir: SortDirection;
}

export function buildAppSortDescriptors(
  sortBy?: string,
  sortDir?: SortDirection,
): SortDescriptor[] {
  const dir = sortDir === "asc" ? "asc" : "desc";

  switch (sortBy) {
    case "canonicalName":
      return [{ field: "canonicalName", dir }];
    case "slug":
      return [{ field: "slug", dir }];
    case "vendorName":
      return [{ field: "vendorName", dir }];
    case "status":
      return [{ field: "status", dir }];
    case "qualityScore":
      return [{ field: "qualityScore", dir }];
    case "qualityState":
      return [{ field: "qualityState", dir }];
    case "verificationTier":
      return [{ field: "verificationTier", dir }];
    case "updatedAt":
    default:
      return [{ field: "updatedAt", dir: "desc" }];
  }
}

export function buildReviewQueueSortDescriptors(
  sortBy?: string,
  sortDir?: SortDirection,
): SortDescriptor[] {
  const dir = sortDir === "asc" ? "asc" : "desc";

  switch (sortBy) {
    case "reviewType":
      return [
        { field: "reviewType", dir },
        { field: "priority", dir: "desc" },
        { field: "createdAt", dir: "desc" },
      ];
    case "status":
      return [
        { field: "status", dir },
        { field: "priority", dir: "desc" },
        { field: "createdAt", dir: "desc" },
      ];
    case "createdAt":
      return [{ field: "createdAt", dir }];
    case "priority":
    default:
      return [
        { field: "priority", dir: "desc" },
        { field: "createdAt", dir: "desc" },
      ];
  }
}
