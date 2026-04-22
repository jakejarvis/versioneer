import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  listCronJobRuns,
  triggerCaskSync,
  triggerEnrichDiscoveries,
  triggerPollSources,
} from "@/server/jobs";

interface UseCronJobRunsParams {
  jobType?: "poll_sources" | "cask_index_sync" | "enrich_discovered_apps";
  trigger?: "manual" | "scheduled";
  status?: "running" | "completed" | "failed";
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useCronJobRuns(params: UseCronJobRunsParams = {}) {
  return useQuery({
    queryKey: ["cron-job-runs", params],
    queryFn: () => listCronJobRuns({ data: params }),
    refetchInterval: params.status === "running" ? 5_000 : undefined,
    placeholderData: keepPreviousData,
  });
}

export function useTriggerPollSources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ force }: { force?: boolean } = {}) =>
      triggerPollSources({ data: { force: force ?? false } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cron-job-runs"] });
      void qc.invalidateQueries({ queryKey: ["job-failures"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useTriggerCaskSync() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => triggerCaskSync(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cron-job-runs"] });
      void qc.invalidateQueries({ queryKey: ["job-failures"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useTriggerEnrichDiscoveries() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => triggerEnrichDiscoveries(),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["cron-job-runs"] });
      void qc.invalidateQueries({ queryKey: ["job-failures"] });
      void qc.invalidateQueries({ queryKey: ["discovered-apps"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
