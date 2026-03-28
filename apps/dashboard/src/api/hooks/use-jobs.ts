import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listCronJobRuns,
  triggerCaskSync,
  triggerPollSources,
  triggerRecomputeScorecards,
} from "@/server/jobs";

interface UseCronJobRunsParams {
  jobType?: "poll_sources" | "recompute_scorecards" | "cask_index_sync";
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useCronJobRuns(params: UseCronJobRunsParams = {}) {
  return useQuery({
    queryKey: ["cron-job-runs", params],
    queryFn: () => listCronJobRuns({ data: params }),
  });
}

export function useTriggerPollSources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ force }: { force?: boolean } = {}) =>
      triggerPollSources({ data: { force: force ?? false } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron-job-runs"] }),
  });
}

export function useTriggerRecomputeScorecards() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => triggerRecomputeScorecards(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron-job-runs"] }),
  });
}

export function useTriggerCaskSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => triggerCaskSync(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["cron-job-runs"] }),
  });
}
