import { useQuery } from "@tanstack/react-query";

import { apiClient } from "../client";

interface AuthUser {
  email: string;
}

export function useAuth() {
  return useQuery({
    queryKey: ["auth", "me"],
    queryFn: () => apiClient<AuthUser>("/auth/me"),
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}
