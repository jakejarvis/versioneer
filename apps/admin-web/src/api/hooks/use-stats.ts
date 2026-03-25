import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../client";
import type { DashboardStats } from "../types";

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => apiClient<DashboardStats>("/stats"),
    refetchInterval: 60_000,
  });
}
