import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../client";
import type { AuditLogEntry, PaginatedResponse } from "../types";

interface UseAuditLogParams {
  eventType?: string;
  targetType?: string;
  limit?: number;
  offset?: number;
}

export function useAuditLog(params: UseAuditLogParams = {}) {
  return useQuery({
    queryKey: ["audit-log", params],
    queryFn: () =>
      apiClient<PaginatedResponse<AuditLogEntry>>("/audit-log", { params: { ...params } }),
  });
}
