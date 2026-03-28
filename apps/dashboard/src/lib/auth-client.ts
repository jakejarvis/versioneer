import type { BetterAuthClientOptions } from "better-auth";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  basePath: "/api/auth",
} satisfies BetterAuthClientOptions);
