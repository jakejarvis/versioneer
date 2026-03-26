import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import {
  getOnboardingChecklist,
  updateOnboardingChecklist,
  onboardApp,
} from "@/server/onboarding.server";

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

export function useOnboardApp() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      app: {
        slug: string;
        canonicalName: string;
        vendorName?: string;
        homepageUrl?: string;
        notes?: string;
      };
      aliases?: {
        aliasType:
          | "bundle_id"
          | "name"
          | "team_id"
          | "sparkle_feed"
          | "homepage"
          | "download_pattern"
          | "github_repo";
        value: string;
        normalizedValue?: string;
        isExact?: boolean;
        priority?: number;
        confidenceWeight?: number;
        source?: string;
      }[];
      source?: {
        sourceType: "sparkle" | "github_releases" | "manual";
        label?: string;
        baseUrl?: string;
        parserKey: string;
        pollIntervalMinutes?: number;
      };
    }) => onboardApp({ data: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
