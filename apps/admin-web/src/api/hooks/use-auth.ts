import { useQuery } from "@tanstack/react-query";

import { getMe } from "@/server/auth";

export function useAuth() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => getMe(),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
