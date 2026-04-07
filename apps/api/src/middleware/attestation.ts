import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import { Jwt } from "hono/utils/jwt";

import { requireSecret } from "@/lib/env";

export const requireAttestation = createMiddleware<{ Bindings: Env }>(async (c, next) => {
  if (c.env.ENVIRONMENT !== "production" || c.env.REQUIRE_ATTESTATION === "false") {
    return next();
  }

  const secret = requireSecret(c.env);
  const header = c.req.header("Authorization");

  if (!header) {
    throw new HTTPException(401, {
      message: "Missing Authorization header — device attestation required",
    });
  }

  const parts = header.split(/\s+/);
  if (parts.length !== 2 || parts[0] !== "Bearer") {
    throw new HTTPException(401, {
      message: "Malformed Authorization header — expected 'Bearer <token>'",
    });
  }

  const token = parts[1]!;
  let payload;
  try {
    payload = await Jwt.verify(token, secret, "HS256");
  } catch (e) {
    const reason = e instanceof Error ? e.message : "unknown";
    if (reason.includes("exp")) {
      throw new HTTPException(401, {
        message: "Attestation token expired — re-attest to obtain a new token",
      });
    }
    throw new HTTPException(401, { message: `Invalid attestation token: ${reason}` });
  }

  c.set("jwtPayload", payload);
  await next();
});
