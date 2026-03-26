import { useQuery } from "@tanstack/react-query";

import { listAuditLog } from "@/server/audit-log";

interface UseAuditLogParams {
  eventType?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}

export function useAuditLog(params: UseAuditLogParams = {}) {
  return useQuery({
    queryKey: ["audit-log", params],
    queryFn: () => listAuditLog({ data: params }),
  });
}
