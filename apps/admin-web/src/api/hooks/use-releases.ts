import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listReleases,
  getRelease,
  updateRelease,
  getReleaseArtifacts,
  getReleaseObservations,
  pinRelease,
  unpinRelease,
} from "@/server/releases";

interface UseReleasesParams {
  appId?: string;
  channel?: "stable" | "beta" | "nightly";
  status?: "active" | "retracted" | "superseded" | "draft";
  limit?: number;
  offset?: number;
}

export function useReleases(params: UseReleasesParams = {}) {
  return useQuery({
    queryKey: ["releases", params],
    queryFn: () => listReleases({ data: params }),
  });
}

export function useRelease(id: string) {
  return useQuery({
    queryKey: ["releases", id],
    queryFn: () => getRelease({ data: { id } }),
    enabled: !!id,
  });
}

export function useUpdateRelease(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      status?: "active" | "retracted" | "superseded" | "draft";
      channel?: "stable" | "beta" | "nightly";
    }) => updateRelease({ data: { id, ...input } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["releases", id] });
    },
  });
}

export function useReleaseArtifacts(releaseId: string) {
  return useQuery({
    queryKey: ["releases", releaseId, "artifacts"],
    queryFn: () => getReleaseArtifacts({ data: { releaseId } }),
    enabled: !!releaseId,
  });
}

export function useReleaseObservations(releaseId: string) {
  return useQuery({
    queryKey: ["releases", releaseId, "observations"],
    queryFn: () => getReleaseObservations({ data: { releaseId } }),
    enabled: !!releaseId,
  });
}

export function usePinRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (releaseId: string) => pinRelease({ data: { id: releaseId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}

export function useUnpinRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (releaseId: string) => unpinRelease({ data: { id: releaseId } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
    },
  });
}
