import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { updateAlias, deleteAlias } from "@/server/aliases";
import {
  listApps,
  getApp,
  createApp,
  updateApp,
  getAppAliases,
  createAlias,
  getAppSources,
  getAppReleases,
  getAppLatest,
  recomputeLatest,
} from "@/server/apps";
import { uploadAppIcon, deleteAppIcon } from "@/server/icons";
import { triggerFetch } from "@/server/sources";

interface UseAppsParams {
  status?: "draft" | "public" | "deprecated" | "merged" | "unlisted";
  search?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useApps(params: UseAppsParams = {}) {
  return useQuery({
    queryKey: ["apps", params],
    queryFn: () => listApps({ data: params }),
  });
}

export function useApp(id: string) {
  return useQuery({
    queryKey: ["apps", id],
    queryFn: () => getApp({ data: { id } }),
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
    }) => createApp({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useUpdateApp(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => updateApp({ data: { id, ...input } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["apps", id] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useAppAliases(appId: string) {
  return useQuery({
    queryKey: ["apps", appId, "aliases"],
    queryFn: () => getAppAliases({ data: { appId } }),
    enabled: !!appId,
  });
}

export function useCreateAlias(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      aliasType:
        | "bundle_id"
        | "name"
        | "team_id"
        | "sparkle_feed"
        | "homepage"
        | "download_pattern"
        | "github_repo"
        | "mas_app_id";
      value: string;
      normalizedValue?: string;
      isExact?: boolean;
      priority?: number;
      confidenceWeight?: number;
      source?: string;
    }) => createAlias({ data: { appId, ...input } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId, "aliases"] });
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
    },
  });
}

export function useUpdateAlias(appId: string) {
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
    }) => updateAlias({ data: { id, ...input } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId, "aliases"] });
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
    },
  });
}

export function useDeleteAlias(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteAlias({ data: { id } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps", appId, "aliases"] });
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
    },
  });
}

export function useAppSources(appId: string) {
  return useQuery({
    queryKey: ["apps", appId, "sources"],
    queryFn: () => getAppSources({ data: { appId } }),
    enabled: !!appId,
  });
}

interface UseAppReleasesParams {
  channel?: string;
  status?: "active" | "superseded" | "draft";
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useAppReleases(appId: string, params: UseAppReleasesParams = {}) {
  return useQuery({
    queryKey: ["apps", appId, "releases", params],
    queryFn: () => getAppReleases({ data: { appId, ...params } }),
    enabled: !!appId,
  });
}

export function useAppLatest(appId: string) {
  return useQuery({
    queryKey: ["apps", appId, "latest"],
    queryFn: () => getAppLatest({ data: { appId } }),
    enabled: !!appId,
  });
}

export function useTriggerFetch() {
  return useMutation({
    mutationFn: ({ sourceId, force }: { sourceId: string; force?: boolean }) =>
      triggerFetch({ data: { sourceId, reason: "manual", force: force ?? false } }),
  });
}

export function useRecomputeLatest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, channel }: { appId: string; channel?: string }) =>
      recomputeLatest({ data: { appId, channel } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["apps"] }),
  });
}

export function useUploadAppIcon(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (file: File) => {
      const buffer = await file.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = "";
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
      }
      const fileBase64 = btoa(binary);
      return uploadAppIcon({
        data: {
          appId,
          fileBase64,
          contentType: file.type as "image/png" | "image/jpeg" | "image/webp",
        },
      });
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
    },
  });
}

export function useDeleteAppIcon(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => deleteAppIcon({ data: { appId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["apps", appId] });
    },
  });
}
