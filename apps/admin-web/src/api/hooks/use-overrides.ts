import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { apiClient } from "../client";
import type { Override, PaginatedResponse } from "../types";

interface UseOverridesParams {
  active?: boolean;
  limit?: number;
  offset?: number;
}

export function useOverrides(params: UseOverridesParams = {}) {
  return useQuery({
    queryKey: ["overrides", params],
    queryFn: () =>
      apiClient<PaginatedResponse<Override>>("/overrides", {
        params: {
          active: params.active !== undefined ? String(params.active) : undefined,
          limit: params.limit,
          offset: params.offset,
        },
      }),
  });
}

export function useCreateOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      overrideType: string;
      targetType: string;
      targetId: string;
      payloadJson: string;
      reason?: string;
      createdBy?: string;
    }) =>
      apiClient<{ id: string }>("/overrides", {
        method: "POST",
        body: input,
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overrides"] }),
  });
}

export function useDeactivateOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiClient(`/overrides/${id}`, { method: "PATCH", body: { isActive: false } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overrides"] }),
  });
}
