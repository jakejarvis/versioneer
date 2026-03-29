import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";

import { createAuth } from "@/lib/auth";

import { authMiddleware } from "./middleware";

const requestMiddleware = createMiddleware().server(async ({ next, request }) => {
  return next({ context: { request } });
});

export const getMe = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    return {
      id: context.user.id,
      email: context.user.email,
      name: context.user.name,
      image: context.user.image,
    };
  });

export const getSession = createServerFn({ method: "GET" })
  .middleware([requestMiddleware])
  .handler(async ({ context }) => {
    const auth = createAuth(env.DB);
    const session = await auth.api.getSession({ headers: context.request.headers });
    if (!session) {
      return null;
    }
    return {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name,
      image: session.user.image,
    };
  });
