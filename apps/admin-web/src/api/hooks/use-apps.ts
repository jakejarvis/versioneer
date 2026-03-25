import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../client";
import type {
  App,
  AppAlias,
  AppLatestRelease,
  Source,
  Release,
  InstallRule,
  PaginatedResponse,
} from "../types";

interface UseAppsParams {
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

export function useApps(params: UseAppsParams = {}) {
  return useQuery({
    queryKey: ["apps", params],
    queryFn: () => apiClient<PaginatedResponse<App>>("/apps", { params: { ...params } }),
  });
}

export function useApp(id: string) {
  return useQuery({
    queryKey: ["apps", id],
    queryFn: () =>
      apiClient<App & { latestReleases: AppLatestRelease[]; sourceCount: number }>(
        `/apps/${id}`,
      ),
    enabled: !!id,
  });
}

export function useCreateApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      slug: string;
      canonicalName: string;
      vendorName?: string;
      homepageUrl?: string;
      notes?: string;
    }) => apiClient<{ id: string }>("/apps", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apps"] }),
  });
}

export function useUpdateApp(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      apiClient(`/apps/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["apps", id] });
    },
  });
}

export function useAppAliases(appId: string) {
  return useQuery({
    queryKey: ["apps", appId, "aliases"],
    queryFn: () => apiClient<{ items: AppAlias[] }>(`/apps/${appId}/aliases`),
    enabled: !!appId,
  });
}

export function useCreateAlias(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      aliasType: string;
      value: string;
      normalizedValue?: string;
      isExact?: boolean;
      priority?: number;
      confidenceWeight?: number;
      source?: string;
    }) =>
      apiClient<{ id: string }>(`/apps/${appId}/aliases`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["apps", appId, "aliases"] }),
  });
}

export function useUpdateAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      isActive?: boolean;
      priority?: number;
      confidenceWeight?: number;
    }) => apiClient(`/aliases/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apps"] }),
  });
}

export function useDeleteAlias() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient(`/aliases/${id}`, { method: "DELETE" }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apps"] }),
  });
}

export function useAppSources(appId: string) {
  return useQuery({
    queryKey: ["apps", appId, "sources"],
    queryFn: () => apiClient<{ items: Source[] }>(`/apps/${appId}/sources`),
    enabled: !!appId,
  });
}

interface UseAppReleasesParams {
  channel?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function useAppReleases(appId: string, params: UseAppReleasesParams = {}) {
  return useQuery({
    queryKey: ["apps", appId, "releases", params],
    queryFn: () =>
      apiClient<PaginatedResponse<Release>>(`/apps/${appId}/releases`, {
        params: { ...params },
      }),
    enabled: !!appId,
  });
}

export function useAppLatest(appId: string) {
  return useQuery({
    queryKey: ["apps", appId, "latest"],
    queryFn: () =>
      apiClient<{ items: AppLatestRelease[] }>(`/apps/${appId}/latest`),
    enabled: !!appId,
  });
}

export function useAppInstallRules(appId: string) {
  return useQuery({
    queryKey: ["apps", appId, "install-rules"],
    queryFn: () =>
      apiClient<{ items: InstallRule[] }>(`/apps/${appId}/install-rules`),
    enabled: !!appId,
  });
}

export function useCreateInstallRule(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      apiClient<{ id: string }>(`/apps/${appId}/install-rules`, {
        method: "POST",
        body: input,
      }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["apps", appId, "install-rules"] }),
  });
}

export function useTriggerFetch() {
  return useMutation({
    mutationFn: ({ sourceId, force }: { sourceId: string; force?: boolean }) =>
      apiClient(`/sources/${sourceId}/fetch`, {
        method: "POST",
        body: { reason: "manual", force: force ?? false },
      }),
  });
}

export function useRecomputeLatest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, channel }: { appId: string; channel?: string }) =>
      apiClient(`/apps/${appId}/recompute-latest`, {
        method: "POST",
        body: { channel },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apps"] }),
  });
}
