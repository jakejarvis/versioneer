import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { getScorecard, recomputeScorecard, promoteVerification } from "@/server/scorecards";

export function useScorecard(appId: string) {
  return useQuery({
    queryKey: ["scorecards", appId],
    queryFn: () => getScorecard({ data: { appId } }),
    enabled: !!appId,
  });
}

export function useRecomputeScorecard() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => recomputeScorecard({ data: { appId } }),
    onSuccess: (_data, appId) => {
      void qc.invalidateQueries({ queryKey: ["scorecards", appId] });
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
    },
  });
}

export function usePromoteVerification() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (appId: string) => promoteVerification({ data: { appId } }),
    onSuccess: (_data, appId) => {
      void qc.invalidateQueries({ queryKey: ["scorecards", appId] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}
