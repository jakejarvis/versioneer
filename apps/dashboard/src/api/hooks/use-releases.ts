import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listReleases,
  getRelease,
  createRelease,
  updateRelease,
  getReleaseArtifacts,
  getReleaseObservations,
  pinRelease,
  unpinRelease,
} from "@/server/releases";

interface UseReleasesParams {
  appId?: string;
  channel?: string;
  status?: "active" | "superseded" | "draft";
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
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

export function useCreateRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      appId: string;
      versionRaw: string;
      buildNumber?: string;
      channel?: string;
      releasedAt?: string;
      releaseNotesHtml?: string;
      releaseNotesUrl?: string;
    }) => createRelease({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}

export function useUpdateRelease(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      status?: "active" | "superseded" | "draft";
      channel?: string;
      releaseNotesHtml?: string | null;
      releaseNotesUrl?: string | null;
    }) => updateRelease({ data: { id, ...input } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["releases", id] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
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
    onSuccess: (_data, releaseId) => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["releases", releaseId] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
    },
  });
}

export function useUnpinRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (releaseId: string) => unpinRelease({ data: { id: releaseId } }),
    onSuccess: (_data, releaseId) => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["releases", releaseId] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
    },
  });
}
