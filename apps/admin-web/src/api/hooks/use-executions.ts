import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../client";
import type { UpdateExecution, PaginatedResponse } from "../types";

interface UseExecutionsParams {
  appId?: string;
  actionStatus?: string;
  limit?: number;
  offset?: number;
}

export function useExecutions(params: UseExecutionsParams = {}) {
  return useQuery({
    queryKey: ["executions", params],
    queryFn: () =>
      apiClient<PaginatedResponse<UpdateExecution>>("/executions", {
        params: { ...params },
      }),
  });
}

export function useExecutionDetail(id: string) {
  return useQuery({
    queryKey: ["executions", id],
    queryFn: () => apiClient<UpdateExecution>(`/executions/${id}`),
    enabled: !!id,
  });
}

export function useExecutionStats() {
  return useQuery({
    queryKey: ["executions", "stats"],
    queryFn: () =>
      apiClient<{ recentExecutions: number; failedExecutions: number }>("/executions/stats"),
  });
}
