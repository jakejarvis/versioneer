import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listSources,
  getSource,
  createSource,
  updateSource,
  getSourceFetches,
  getSourceFetch,
  getParserRuns,
  triggerFetch,
  reparse,
  getSourceHealth,
} from "@/server/sources";

interface UseSourcesParams {
  status?: "active" | "paused" | "disabled" | "error";
  sourceType?: "sparkle" | "github_releases" | "manual" | "homebrew_cask";
  appId?: string;
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useSources(params: UseSourcesParams = {}) {
  return useQuery({
    queryKey: ["sources", params],
    queryFn: () => listSources({ data: params }),
  });
}

export function useSource(id: string) {
  return useQuery({
    queryKey: ["sources", id],
    queryFn: () => getSource({ data: { id } }),
    enabled: !!id,
  });
}

export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      appId: string;
      sourceType: "sparkle" | "github_releases" | "manual" | "homebrew_cask";
      label?: string;
      baseUrl?: string;
      configJson?: string;
      parserKey: string;
      pollIntervalMinutes?: number;
    }) => createSource({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useUpdateSource(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => updateSource({ data: { id, ...input } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["sources", id] });
    },
  });
}

export function useSourceFetches(
  sourceId: string,
  params: { limit?: number; offset?: number; sortBy?: string; sortDir?: "asc" | "desc" } = {},
) {
  return useQuery({
    queryKey: ["sources", sourceId, "fetches", params],
    queryFn: () => getSourceFetches({ data: { sourceId, ...params } }),
    enabled: !!sourceId,
  });
}

export function useSourceFetch(id: string) {
  return useQuery({
    queryKey: ["source-fetches", id],
    queryFn: () => getSourceFetch({ data: { id } }),
    enabled: !!id,
  });
}

export function useParserRuns(fetchId: string) {
  return useQuery({
    queryKey: ["source-fetches", fetchId, "parser-runs"],
    queryFn: () => getParserRuns({ data: { fetchId } }),
    enabled: !!fetchId,
  });
}

export function useTriggerSourceFetch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, force }: { sourceId: string; force?: boolean }) =>
      triggerFetch({ data: { sourceId, reason: "manual", force: force ?? false } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useReparse() {
  return useMutation({
    mutationFn: (fetchId: string) => reparse({ data: { sourceFetchId: fetchId } }),
  });
}

export function useSourceHealth(sourceId: string) {
  return useQuery({
    queryKey: ["sources", sourceId, "health"],
    queryFn: () => getSourceHealth({ data: { sourceId } }),
    enabled: !!sourceId,
  });
}
