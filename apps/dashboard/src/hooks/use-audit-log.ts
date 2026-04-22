import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { listAuditLog } from "@/server/audit-log";

interface UseAuditLogParams {
  eventType?: string;
  targetType?: string;
  targetId?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useAuditLog(params: UseAuditLogParams = {}) {
  return useQuery({
    queryKey: ["audit-log", params],
    queryFn: () => listAuditLog({ data: params }),
    placeholderData: keepPreviousData,
  });
}
