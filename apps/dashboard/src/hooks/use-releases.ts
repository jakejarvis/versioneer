import { keepPreviousData, useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  listReleases,
  getRelease,
  createRelease,
  updateRelease,
  getReleaseArtifacts,
  createReleaseArtifact,
  getReleaseObservations,
  pinRelease,
  unpinRelease,
} from "@/server/releases";

interface UseReleasesParams {
  appId?: string;
  channel?: string;
  status?: "active" | "superseded" | "draft" | "withdrawn";
  limit?: number;
  offset?: number;
  sortBy?: string;
  sortDir?: "asc" | "desc";
}

export function useReleases(params: UseReleasesParams = {}) {
  return useQuery({
    queryKey: ["releases", params],
    queryFn: () => listReleases({ data: params }),
    placeholderData: keepPreviousData,
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
      releaseNotesMarkdown?: string;
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
      status?: "active" | "superseded" | "draft" | "withdrawn";
      channel?: string;
      releaseNotesMarkdown?: string | null;
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

export function useCreateReleaseArtifact(releaseId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      artifactType: "zip" | "dmg" | "pkg" | "appcast_enclosure" | "mac_app_store" | "other";
      url: string;
      architecture: "arm64" | "x86_64" | "universal" | "unknown";
      sha256?: string | null;
      sizeBytes?: number | null;
      minOsVersion?: string | null;
    }) => createReleaseArtifact({ data: { releaseId, ...input } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["releases", releaseId] });
      void qc.invalidateQueries({ queryKey: ["releases", releaseId, "artifacts"] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
    },
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
    mutationFn: (input: { releaseId: string; targetArchitecture: "arm64" | "x86_64" }) =>
      pinRelease({ data: { id: input.releaseId, targetArchitecture: input.targetArchitecture } }),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["releases", input.releaseId] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
    },
  });
}

export function useUnpinRelease() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: { releaseId: string; targetArchitecture: "arm64" | "x86_64" }) =>
      unpinRelease({ data: { id: input.releaseId, targetArchitecture: input.targetArchitecture } }),
    onSuccess: (_data, input) => {
      void qc.invalidateQueries({ queryKey: ["releases"] });
      void qc.invalidateQueries({ queryKey: ["releases", input.releaseId] });
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
    },
  });
}
