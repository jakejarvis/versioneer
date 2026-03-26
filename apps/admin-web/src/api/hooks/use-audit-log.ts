import { useQuery } from "@tanstack/react-query";

import { listAuditLog } from "@/server/audit-log.server";

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
