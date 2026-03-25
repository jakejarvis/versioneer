import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client";
import type { ReviewQueueItem, PaginatedResponse } from "../types";

interface UseReviewQueueParams {
  status?: string;
  limit?: number;
  offset?: number;
}

export function useReviewQueue(params: UseReviewQueueParams = {}) {
  return useQuery({
    queryKey: ["review-queue", params],
    queryFn: () =>
      apiClient<PaginatedResponse<ReviewQueueItem>>("/review-queue", {
        params: { ...params },
      }),
  });
}

export function useUpdateReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient(`/review-queue/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["review-queue"] }),
  });
}

export function useResolveMatch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      appId,
      aliasType,
      value,
    }: {
      id: string;
      appId: string;
      aliasType: string;
      value: string;
    }) =>
      apiClient<{ status: string; aliasId: string }>(`/review-queue/${id}/resolve-match`, {
        method: "POST",
        body: { appId, aliasType, value },
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["review-queue"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}

export function useApprovePublication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient<{ status: string; overrideId: string }>(`/review-queue/${id}/approve-publication`, {
        method: "POST",
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["review-queue"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}
