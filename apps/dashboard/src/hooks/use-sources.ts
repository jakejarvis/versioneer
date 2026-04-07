import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SourceType } from "@versioneer/schemas/sources";

import { validateSource } from "@/server/source-validation";
import {
  listSources,
  getSource,
  createSource,
  updateSource,
  reorderSources,
  getSourceFetches,
  getSourceFetch,
  getParserRuns,
  triggerFetch,
  reparse,
} from "@/server/sources";

interface UseSourcesParams {
  status?: "active" | "paused" | "disabled" | "error" | "at_risk";
  sourceType?: SourceType;
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
      sourceType: SourceType;
      label?: string;
      baseUrl?: string;
      configJson?: string;
      parserKey: string;
      channel?: string;
      pollIntervalMinutes?: number;
    }) => createSource({ data: input }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["apps", variables.appId, "sources"] });
      void qc.invalidateQueries({ queryKey: ["apps", variables.appId] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useUpdateSource(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) => updateSource({ data: { id, ...input } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["sources", id] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
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
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
    },
  });
}

export function useReorderSources() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ appId, sourceIds }: { appId: string; sourceIds: string[] }) =>
      reorderSources({ data: { appId, sourceIds } }),
    onSuccess: (_data, variables) => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["apps", variables.appId, "sources"] });
      void qc.invalidateQueries({ queryKey: ["apps", variables.appId] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
    },
  });
}

export function useBulkUpdateSourceStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: "active" | "paused" | "disabled" }) =>
      updateSource({ data: { id, status } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useValidateSource() {
  return useMutation({
    mutationFn: (input: { url: string; sourceType: SourceType; configJson?: string }) =>
      validateSource({ data: input }),
  });
}

export function useReparse(sourceId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fetchId: string) => reparse({ data: { sourceFetchId: fetchId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources", sourceId, "fetches"] });
      void qc.invalidateQueries({ queryKey: ["source-fetches"] });
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}
