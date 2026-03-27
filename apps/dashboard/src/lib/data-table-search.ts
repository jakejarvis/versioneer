import {
  functionalUpdate,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { z } from "zod";

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
export type SortDirection = "asc" | "desc";
export const pageSizeSchema = z.union([z.literal(25), z.literal(50), z.literal(100)]).catch(50);
export const paginatedSearchShape = {
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: pageSizeSchema,
  sortBy: z.string().optional(),
  sortDir: z.enum(["asc", "desc"]).optional(),
};

export interface PaginatedSearchState {
  page: number;
  pageSize: number;
  sortBy?: string;
  sortDir?: SortDirection;
}

export function paginationFromSearch(search: PaginatedSearchState): PaginationState {
  return {
    pageIndex: Math.max(search.page - 1, 0),
    pageSize: search.pageSize,
  };
}

export function sortingFromSearch(search: PaginatedSearchState): SortingState {
  if (!search.sortBy) {
    return [];
  }

  return [
    {
      id: search.sortBy,
      desc: search.sortDir !== "asc",
    },
  ];
}

export function applyPaginationToSearch<T extends PaginatedSearchState>(
  prev: T,
  updater: Updater<PaginationState>,
): T {
  const next = functionalUpdate(updater, paginationFromSearch(prev));

  return {
    ...prev,
    page: next.pageIndex + 1,
    pageSize: next.pageSize,
  };
}

export function applySortingToSearch<T extends PaginatedSearchState>(
  prev: T,
  updater: Updater<SortingState>,
): T {
  const next = functionalUpdate(updater, sortingFromSearch(prev));
  const nextSort = next[0];

  return {
    ...prev,
    page: 1,
    sortBy: nextSort?.id,
    sortDir: nextSort ? (nextSort.desc ? "desc" : "asc") : undefined,
  };
}
