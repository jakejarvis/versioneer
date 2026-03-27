import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listJobFailures,
  updateJobFailure,
  retryJobFailure,
  retryAllJobFailures,
} from "@/server/job-failures";

interface UseJobFailuresParams {
  status?: "open" | "retrying" | "resolved" | "abandoned";
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useJobFailures(params: UseJobFailuresParams = {}) {
  return useQuery({
    queryKey: ["job-failures", params],
    queryFn: () => listJobFailures({ data: params }),
  });
}

export function useUpdateJobFailure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "resolved" | "abandoned" | "retrying" }) =>
      updateJobFailure({ data: { id, status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-failures"] }),
  });
}

export function useRetryJobFailure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => retryJobFailure({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-failures"] }),
  });
}

export function useRetryAllJobFailures() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (jobType?: string) => retryAllJobFailures({ data: jobType ? { jobType } : {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-failures"] }),
  });
}
