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
    case "updatedAt":
    default:
      return [{ field: "updatedAt", dir: "desc" }];
  }
}
