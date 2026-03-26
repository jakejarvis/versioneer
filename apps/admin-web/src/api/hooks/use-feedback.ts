import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { listFeedback, getFeedbackDetail, updateFeedback } from "@/server/feedback";

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
    queryFn: () => listFeedback({ data: params }),
  });
}

export function useFeedbackDetail(id: string) {
  return useQuery({
    queryKey: ["feedback", id],
    queryFn: () => getFeedbackDetail({ data: { id } }),
    enabled: !!id,
  });
}

export function useUpdateFeedback() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      status,
    }: {
      id: string;
      status: "new" | "triaged" | "resolved" | "dismissed";
    }) => updateFeedback({ data: { id, status } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["feedback"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
