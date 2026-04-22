import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  dismissDiscoveredApp,
  getDiscoveredApp,
  listDiscoveredApps,
  reEnrichDiscoveredApp,
} from "@/server/discovered-apps";

interface UseDiscoveredAppsParams {
  status?: "pending" | "linked" | "dismissed" | "support_only";
  enrichmentStatus?: "pending" | "in_progress" | "success" | "failed" | "skipped";
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useDiscoveredApps(params: UseDiscoveredAppsParams = {}) {
  return useQuery({
    queryKey: ["discovered-apps", params],
    queryFn: () => listDiscoveredApps({ data: params }),
    refetchInterval: 60_000,
    placeholderData: keepPreviousData,
  });
}

export function useDiscoveredApp(id: string | null) {
  return useQuery({
    queryKey: ["discovered-app", id],
    queryFn: () => getDiscoveredApp({ data: { id: id! } }),
    enabled: !!id,
  });
}

export function useDismissDiscoveredApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dismissDiscoveredApp({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["discovered-apps"] });
      void qc.invalidateQueries({ queryKey: ["discovered-app"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useReEnrichDiscoveredApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => reEnrichDiscoveredApp({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["discovered-apps"] });
      void qc.invalidateQueries({ queryKey: ["discovered-app"] });
    },
  });
}
