import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { REVIEW_APPROVAL_STALE_MS } from "@/lib/review-lifecycle";
import {
  approveCatalogSuggestion,
  getCatalogSuggestion,
  listCatalogSuggestions,
  rejectCatalogSuggestion,
} from "@/server/review";
import type { QueueType, SuggestionStatus } from "@versioneer/schemas/review";

const REVIEW_SUGGESTION_REFETCH_MS = Math.min(REVIEW_APPROVAL_STALE_MS, 60_000);

export function useCatalogSuggestions(
  params: {
    status?: SuggestionStatus;
    queueType?: QueueType;
    limit?: number;
    offset?: number;
    sortBy?: string;
    sortDir?: "asc" | "desc";
  } = {},
) {
  return useQuery({
    queryKey: ["catalog-suggestions", params],
    queryFn: () => listCatalogSuggestions({ data: params }),
    placeholderData: keepPreviousData,
    refetchInterval: REVIEW_SUGGESTION_REFETCH_MS,
  });
}

export function useCatalogSuggestion(id: string) {
  return useQuery({
    queryKey: ["catalog-suggestions", id],
    queryFn: () => getCatalogSuggestion({ data: { id } }),
    enabled: !!id,
    refetchInterval: REVIEW_SUGGESTION_REFETCH_MS,
  });
}

export function useApproveCatalogSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approveCatalogSuggestion({ data: { id } }),
    onSettled: async (_result, _error, id) => {
      void qc.invalidateQueries({ queryKey: ["catalog-suggestions"] });
      void qc.invalidateQueries({ queryKey: ["catalog-suggestions", id] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["discovered-apps"] });
    },
  });
}

export function useRejectCatalogSuggestion() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rejectCatalogSuggestion({ data: { id } }),
    onSettled: async (_result, _error, id) => {
      void qc.invalidateQueries({ queryKey: ["catalog-suggestions"] });
      void qc.invalidateQueries({ queryKey: ["catalog-suggestions", id] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
