import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getOnboardingChecklist,
  updateOnboardingChecklist,
  onboardDiscoveredApp,
  checkSlugAvailable,
} from "@/server/onboarding";
import { validateSource } from "@/server/source-validation";

export function useOnboardingChecklist(appId: string) {
  return useQuery({
    queryKey: ["onboarding", appId],
    queryFn: () => getOnboardingChecklist({ data: { appId } }),
    enabled: !!appId,
  });
}

export function useUpdateOnboardingChecklist(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, boolean>) =>
      updateOnboardingChecklist({ data: { appId, ...input } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["onboarding", appId] }),
  });
}

export function useCheckSlugAvailable(slug: string) {
  return useQuery({
    queryKey: ["slug-check", slug],
    queryFn: () => checkSlugAvailable({ data: { slug } }),
    enabled: slug.length >= 2,
  });
}

export function useValidateSource() {
  return useMutation({
    mutationFn: (input: { url: string; sourceType: "sparkle" | "github_releases" }) =>
      validateSource({ data: input }),
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
      }[];
      source?: {
        sourceType: "sparkle" | "github_releases" | "manual";
        baseUrl: string;
        parserKey: string;
        pollIntervalMinutes?: number;
        label?: string;
      };
      sourceValidated?: boolean;
      enrichmentHasReleases?: boolean;
    }) => onboardDiscoveredApp({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["discovered-apps"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
