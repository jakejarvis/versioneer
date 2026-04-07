import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { onboardDiscoveredApp, checkSlugAvailable, lookupCaskToken } from "@/server/onboarding";
import type { AliasType } from "@versioneer/schemas/catalog";
import type { SourceType } from "@versioneer/schemas/sources";

export function useCheckSlugAvailable(slug: string) {
  return useQuery({
    queryKey: ["slug-check", slug],
    queryFn: () => checkSlugAvailable({ data: { slug } }),
    enabled: slug.length >= 2,
    staleTime: 0,
  });
}

export function useLookupCaskToken(bundleId: string | null) {
  return useQuery({
    queryKey: ["cask-token-lookup", bundleId],
    queryFn: () => lookupCaskToken({ data: { bundleId: bundleId! } }),
    enabled: !!bundleId,
  });
}

export function useOnboardDiscoveredApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      discoveredAppId: string;
      app: {
        slug: string;
        canonicalName: string;
        vendorName?: string;
        homepageUrl?: string;
        notes?: string;
      };
      aliases: {
        aliasType: AliasType;
        value: string;
      }[];
      sources?: {
        sourceType: SourceType;
        baseUrl: string;
        parserKey: string;
        pollIntervalMinutes?: number;
        label?: string;
        status?: "active" | "paused";
        configJson?: string;
      }[];
      sourceValidated?: boolean;
      enrichmentHasReleases?: boolean;
    }) => onboardDiscoveredApp({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["discovered-apps"] });
      void qc.invalidateQueries({ queryKey: ["discovered-app"] });
      void qc.invalidateQueries({ queryKey: ["catalog-suggestions"] });
      void qc.invalidateQueries({ queryKey: ["homepage"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
