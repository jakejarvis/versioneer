import { createMiddleware } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

import { createAuth } from "@/lib/auth";

export const authMiddleware = createMiddleware().server(async ({ next, request }) => {
  const auth = createAuth(env.DB);
  const session = await auth.api.getSession({ headers: request.headers });

  if (!session) {
    throw new Response(null, { status: 302, headers: { Location: "/login" } });
  }

  return next({
    context: {
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
      },
    },
  });
});
