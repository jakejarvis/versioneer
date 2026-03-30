import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { listCronJobRuns, triggerCaskSync, triggerPollSources } from "@/server/jobs";

interface UseCronJobRunsParams {
  jobType?: "poll_sources" | "cask_index_sync" | "enrich_discovered_apps";
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cron-job-runs"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
    },
  });
}

export function useTriggerCaskSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => triggerCaskSync(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cron-job-runs"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
    },
  });
}
