import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client";
import type { OnboardingChecklist } from "../types";

export function useOnboardingChecklist(appId: string) {
  return useQuery({
    queryKey: ["onboarding", appId],
    queryFn: () => apiClient<OnboardingChecklist>(`/onboarding/${appId}`),
    enabled: !!appId,
  });
}

export function useUpdateOnboardingChecklist(appId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: Record<string, boolean>) =>
      apiClient(`/onboarding/${appId}`, { method: "PATCH", body: input }),
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
      aliases?: { aliasType: string; value: string }[];
      source?: {
        sourceType: string;
        label?: string;
        baseUrl?: string;
        parserKey: string;
        pollIntervalMinutes?: number;
      };
    }) => apiClient<{ id: string }>("/onboarding", { method: "POST", body: input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["apps"] });
      void qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
}
