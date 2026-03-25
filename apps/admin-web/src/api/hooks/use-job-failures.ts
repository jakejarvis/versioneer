import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client";
import type { JobFailure, PaginatedResponse } from "../types";

interface UseJobFailuresParams {
  status?: string;
  limit?: number;
  offset?: number;
}

export function useJobFailures(params: UseJobFailuresParams = {}) {
  return useQuery({
    queryKey: ["job-failures", params],
    queryFn: () =>
      apiClient<PaginatedResponse<JobFailure>>("/job-failures", {
        params: { ...params },
      }),
  });
}

export function useUpdateJobFailure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) =>
      apiClient(`/job-failures/${id}`, { method: "PATCH", body: { status } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-failures"] }),
  });
}

export function useRetryJobFailure() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiClient(`/job-failures/${id}/retry`, { method: "POST" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["job-failures"] }),
  });
}
