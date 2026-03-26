import { useQuery } from "@tanstack/react-query";

import { getStats } from "@/server/stats.server";

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => getStats(),
    refetchInterval: 60_000,
  });
}
