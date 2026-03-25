import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client";
import type {
  Source,
  SourceFetch,
  SourceHealthMetric,
  ParserRun,
  PaginatedResponse,
} from "../types";

interface UseSourcesParams {
  status?: string;
  sourceType?: string;
  appId?: string;
  limit?: number;
  offset?: number;
}

export function useSources(params: UseSourcesParams = {}) {
  return useQuery({
    queryKey: ["sources", params],
    queryFn: () =>
      apiClient<PaginatedResponse<Source>>("/sources", {
        params: { ...params },
      }),
  });
}

export function useSource(id: string) {
  return useQuery({
    queryKey: ["sources", id],
    queryFn: () => apiClient<Source>(`/sources/${id}`),
    enabled: !!id,
  });
}

export function useCreateSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      appId: string;
      sourceType: string;
      label?: string;
      baseUrl?: string;
      configJson?: string;
      parserKey: string;
      pollIntervalMinutes?: number;
    }) => apiClient<{ id: string }>("/sources", { method: "POST", body: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useUpdateSource(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      apiClient(`/sources/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["sources"] });
      void qc.invalidateQueries({ queryKey: ["sources", id] });
    },
  });
}

export function useSourceFetches(
  sourceId: string,
  params: { limit?: number; offset?: number } = {},
) {
  return useQuery({
    queryKey: ["sources", sourceId, "fetches", params],
    queryFn: () =>
      apiClient<PaginatedResponse<SourceFetch>>(`/sources/${sourceId}/fetches`, {
        params: { ...params },
      }),
    enabled: !!sourceId,
  });
}

export function useSourceFetch(id: string) {
  return useQuery({
    queryKey: ["source-fetches", id],
    queryFn: () => apiClient<SourceFetch>(`/sources/fetches/${id}`),
    enabled: !!id,
  });
}

export function useParserRuns(fetchId: string) {
  return useQuery({
    queryKey: ["source-fetches", fetchId, "parser-runs"],
    queryFn: () => apiClient<{ items: ParserRun[] }>(`/sources/fetches/${fetchId}/parser-runs`),
    enabled: !!fetchId,
  });
}

export function useTriggerSourceFetch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId, force }: { sourceId: string; force?: boolean }) =>
      apiClient(`/sources/${sourceId}/fetch`, {
        method: "POST",
        body: { reason: "manual", force: force ?? false },
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["sources"] }),
  });
}

export function useReparse() {
  return useMutation({
    mutationFn: (fetchId: string) =>
      apiClient(`/sources/fetches/${fetchId}/reparse`, { method: "POST" }),
  });
}

export function useSourceHealth(sourceId: string) {
  return useQuery({
    queryKey: ["sources", sourceId, "health"],
    queryFn: () => apiClient<{ items: SourceHealthMetric[] }>(`/sources/${sourceId}/health`),
    enabled: !!sourceId,
  });
}
