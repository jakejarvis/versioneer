import { useQuery } from "@tanstack/react-query";

import { listExecutions, getExecutionDetail, getExecutionStats } from "@/server/executions.server";

interface UseExecutionsParams {
  appId?: string;
  actionStatus?: string;
  limit?: number;
  offset?: number;
}

export function useExecutions(params: UseExecutionsParams = {}) {
  return useQuery({
    queryKey: ["executions", params],
    queryFn: () => listExecutions({ data: params }),
  });
}

export function useExecutionDetail(id: string) {
  return useQuery({
    queryKey: ["executions", id],
    queryFn: () => getExecutionDetail({ data: { id } }),
    enabled: !!id,
  });
}

export function useExecutionStats() {
  return useQuery({
    queryKey: ["executions", "stats"],
    queryFn: () => getExecutionStats(),
  });
}
