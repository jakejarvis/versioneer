import { HTTPException } from "hono/http-exception";

export function requireSecret(env: Env): string {
  const secret = env.JWT_SECRET;
  if (!secret) throw new HTTPException(500, { message: "JWT_SECRET not configured" });
  return secret;
}
