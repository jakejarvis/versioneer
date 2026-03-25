import { createMiddleware } from "hono/factory";

import type { Env } from "../env";
import type { AuthVariables } from "./types";
import { verifyCfAccessJwt } from "./verify-jwt";

function getTokenFromCookie(cookieHeader: string | undefined): string | undefined {
  if (!cookieHeader) return undefined;
  const match = cookieHeader.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match?.[1];
}

export const cfAccessAuth = createMiddleware<{
  Bindings: Env;
  Variables: AuthVariables;
}>(async (c, next) => {
  const token =
    c.req.header("Cf-Access-Jwt-Assertion") ?? getTokenFromCookie(c.req.header("Cookie"));

  if (!token) {
    if (c.env.ENVIRONMENT === "dev") {
      c.set("user", { email: "dev@localhost", sub: "dev-local" });
      return next();
    }
    return c.json({ error: "Unauthorized: missing access token" }, 401);
  }

  try {
    const user = await verifyCfAccessJwt(token, c.env.CF_ACCESS_TEAM_DOMAIN, c.env.CF_ACCESS_AUD);
    c.set("user", user);
    return next();
  } catch (err) {
    console.error("Auth failed:", err);
    return c.json({ error: "Unauthorized: invalid access token" }, 401);
  }
});
