import { createMiddleware } from "hono/factory";
import { jwt } from "hono/jwt";

import { requireSecret } from "@/lib/env";

export const requireAttestation = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  return jwt({ secret: requireSecret(c.env), alg: "HS256" })(c, next);
});
