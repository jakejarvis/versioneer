import { createMiddleware } from "hono/factory";
import { jwt } from "hono/jwt";

/**
 * JWT auth middleware for App Attest-issued tokens.
 * Validates the Authorization: Bearer <jwt> header using HS256 with JWT_SECRET.
 */
export const requireAttestation = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  const jwtMiddleware = jwt({
    secret: c.env.JWT_SECRET!,
    alg: "HS256",
  });
  return jwtMiddleware(c, next);
});
