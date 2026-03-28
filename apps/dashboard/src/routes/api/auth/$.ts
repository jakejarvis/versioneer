import { createFileRoute } from "@tanstack/react-router";
import { env } from "cloudflare:workers";

import { createAuth } from "@/lib/auth";

export const Route = createFileRoute("/api/auth/$")({
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const auth = createAuth(env.DB);
        return auth.handler(request);
      },
      POST: async ({ request }: { request: Request }) => {
        const auth = createAuth(env.DB);
        return auth.handler(request);
      },
    },
  },
});
