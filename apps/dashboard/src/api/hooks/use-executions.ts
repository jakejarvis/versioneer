import { useQuery } from "@tanstack/react-query";

import { listExecutions, getExecutionDetail, getExecutionStats } from "@/server/executions";

interface UseExecutionsParams {
  appId?: string;
  actionStatus?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
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
