import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  approveDiscoveredApp,
  dismissDiscoveredApp,
  listDiscoveredApps,
} from "@/server/discovered-apps";

interface UseDiscoveredAppsParams {
  status?: "pending" | "approved" | "dismissed";
  limit?: number;
  offset?: number;
}

export function useDiscoveredApps(params: UseDiscoveredAppsParams = {}) {
  return useQuery({
    queryKey: ["discovered-apps", params],
    queryFn: () => listDiscoveredApps({ data: params }),
  });
}

export function useDismissDiscoveredApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => dismissDiscoveredApp({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["discovered-apps"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useApproveDiscoveredApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, appId }: { id: string; appId: string }) =>
      approveDiscoveredApp({ data: { id, appId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["discovered-apps"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
      void qc.invalidateQueries({ queryKey: ["sources"] });
    },
  });
}
