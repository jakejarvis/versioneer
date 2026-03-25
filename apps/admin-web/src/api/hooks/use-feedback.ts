import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client";
import type { FeedbackItem, PaginatedResponse } from "../types";

interface UseFeedbackParams {
  status?: string;
  feedbackType?: string;
  targetAppId?: string;
  limit?: number;
  offset?: number;
}

export function useFeedback(params: UseFeedbackParams = {}) {
  return useQuery({
    queryKey: ["feedback", params],
    queryFn: () =>
      apiClient<PaginatedResponse<FeedbackItem>>("/feedback", {
        params: { ...params },
      }),
  });
}

export function useFeedbackDetail(id: string) {
  return useQuery({
    queryKey: ["feedback", id],
    queryFn: () => apiClient<FeedbackItem>(`/feedback/${id}`),
    enabled: !!id,
  });
}

export function useUpdateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient(`/feedback/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["feedback"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
