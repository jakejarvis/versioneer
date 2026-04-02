import { useQuery } from "@tanstack/react-query";

import { getHomepage } from "@/server/homepage";

export function useHomepage() {
  return useQuery({
    queryKey: ["homepage"],
    queryFn: () => getHomepage(),
    refetchInterval: 60_000,
  });
}
