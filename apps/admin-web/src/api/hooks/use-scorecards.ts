import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client";
import type { AppScorecard } from "../types";

export function useScorecard(appId: string) {
  return useQuery({
    queryKey: ["scorecards", appId],
    queryFn: () => apiClient<AppScorecard>(`/scorecards/${appId}`),
    enabled: !!appId,
  });
}

export function useRecomputeScorecard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => apiClient(`/scorecards/${appId}/recompute`, { method: "POST" }),
    onSuccess: (_data, appId) => {
      void qc.invalidateQueries({ queryKey: ["scorecards", appId] });
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
    },
  });
}

export function usePromoteVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) =>
      apiClient<{ status: string; verificationTier: string }>(`/scorecards/${appId}/promote`, {
        method: "POST",
      }),
    onSuccess: (_data, appId) => {
      void qc.invalidateQueries({ queryKey: ["scorecards", appId] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}
