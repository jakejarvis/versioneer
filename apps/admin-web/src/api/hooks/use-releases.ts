import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiClient } from "../client";
import type {
  Release,
  Artifact,
  ReleaseObservation,
  PaginatedResponse,
} from "../types";

interface UseReleasesParams {
  appId?: string;
  channel?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export function useReleases(params: UseReleasesParams = {}) {
  return useQuery({
    queryKey: ["releases", params],
    queryFn: () =>
      apiClient<PaginatedResponse<Release>>("/releases", {
        params: { ...params },
      }),
  });
}

export function useRelease(id: string) {
  return useQuery({
    queryKey: ["releases", id],
    queryFn: () => apiClient<Release>(`/releases/${id}`),
    enabled: !!id,
  });
}

export function useUpdateRelease(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { status?: string; channel?: string }) =>
      apiClient(`/releases/${id}`, { method: "PATCH", body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["releases", id] });
    },
  });
}

export function useReleaseArtifacts(releaseId: string) {
  return useQuery({
    queryKey: ["releases", releaseId, "artifacts"],
    queryFn: () =>
      apiClient<{ items: Artifact[] }>(`/releases/${releaseId}/artifacts`),
    enabled: !!releaseId,
  });
}

export function useReleaseObservations(releaseId: string) {
  return useQuery({
    queryKey: ["releases", releaseId, "observations"],
    queryFn: () =>
      apiClient<{ items: ReleaseObservation[] }>(
        `/releases/${releaseId}/observations`,
      ),
    enabled: !!releaseId,
  });
}
