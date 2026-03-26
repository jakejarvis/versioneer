import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { listOverrides, createOverride, deactivateOverride } from "@/server/overrides.server";

interface UseOverridesParams {
  active?: boolean;
  limit?: number;
  offset?: number;
}

export function useOverrides(params: UseOverridesParams = {}) {
  return useQuery({
    queryKey: ["overrides", params],
    queryFn: () => listOverrides({ data: params }),
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
    }) => createOverride({ data: input }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overrides"] }),
  });
}

export function useDeactivateOverride() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deactivateOverride({ data: { id } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["overrides"] }),
  });
}
