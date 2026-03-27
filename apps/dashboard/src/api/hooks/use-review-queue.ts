import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listReviewQueue,
  updateReviewItem,
  resolveMatch,
  approvePublication,
} from "@/server/review-queue";

interface UseReviewQueueParams {
  status?: "pending" | "in_progress" | "resolved" | "dismissed";
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useReviewQueue(params: UseReviewQueueParams = {}) {
  return useQuery({
    queryKey: ["review-queue", params],
    queryFn: () => listReviewQueue({ data: params }),
  });
}

export function useUpdateReviewItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "resolved" | "dismissed" | "in_progress";
    }) => updateReviewItem({ data: { id, status } }),
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
      aliasType:
        | "bundle_id"
        | "name"
        | "team_id"
        | "sparkle_feed"
        | "homepage"
        | "download_pattern"
        | "github_repo"
        | "mas_app_id";
      value: string;
    }) => resolveMatch({ data: { id, appId, aliasType, value } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["review-queue"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}

export function useApprovePublication() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => approvePublication({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["review-queue"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}
