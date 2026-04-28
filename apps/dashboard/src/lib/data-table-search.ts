import {
  functionalUpdate,
  type PaginationState,
  type SortingState,
  type Updater,
} from "@tanstack/react-table";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";

export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export type PageSizeOption = (typeof PAGE_SIZE_OPTIONS)[number];
export type SortDirection = "asc" | "desc";
export const paginatedSearchDefaults = {
  page: 1,
  pageSize: 50 as PageSizeOption,
};
export const paginatedSearchShape = {
  page: z.coerce
    .number()
    .int()
    .min(1)
    .default(paginatedSearchDefaults.page)
    .catch(paginatedSearchDefaults.page),
  pageSize: z
    .union([z.literal(25), z.literal(50), z.literal(100)])
    .default(paginatedSearchDefaults.pageSize)
    .catch(paginatedSearchDefaults.pageSize),
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

export function useDebouncedSearchInput({
  value,
  onCommit,
  delayMs = 300,
}: {
  value: string;
  onCommit: (value: string) => void;
  delayMs?: number;
}) {
  const [draftValue, setDraftValue] = useState(value);
  const latestOnCommit = useRef(onCommit);

  useEffect(() => {
    latestOnCommit.current = onCommit;
  }, [onCommit]);

  useEffect(() => {
    setDraftValue(value);
  }, [value]);

  useEffect(() => {
    if (draftValue === value) {
      return undefined;
    }

    const timeout = window.setTimeout(() => {
      latestOnCommit.current(draftValue);
    }, delayMs);

    return () => window.clearTimeout(timeout);
  }, [delayMs, draftValue, value]);

  return [draftValue, setDraftValue] as const;
}
