import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

export interface RateLimitOptions {
  prefix: string;
}

function jwtSubject(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const subject = (payload as { sub?: unknown }).sub;
  return typeof subject === "string" && subject.length > 0 ? subject : null;
}

async function hashKeyPart(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function rateLimitKey(c: Context<{ Bindings: Env }>, prefix: string) {
  // requireAttestation verifies the token first, so sub is our stable desktop device actor key.
  // Avoid IP-based keys: NATs, mobile networks, and privacy proxies can group unrelated users.
  const deviceId = jwtSubject(c.get("jwtPayload"));
  if (deviceId) return `${prefix}:device:${deviceId}`;

  // Local/dev paths may still send Authorization; hash it so bearer material never becomes a key.
  const authorization = c.req.header("Authorization");
  if (authorization) return `${prefix}:auth:${await hashKeyPart(authorization)}`;

  return `${prefix}:anonymous`;
}

export function createRateLimit(options: RateLimitOptions) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    // If attestation is globally disabled, disable this limiter too; fallback buckets are too broad.
    if (c.env.REQUIRE_ATTESTATION === "false") {
      await next();
      return;
    }

    const key = await rateLimitKey(c, options.prefix);
    const outcome = await c.env.CLIENT_RATE_LIMITER.limit({ key });

    if (!outcome.success) {
      throw new HTTPException(429, {
        message: "Too many requests, please retry later",
      });
    }

    await next();
  });
}

export const clientRateLimit = createRateLimit({
  prefix: "client",
});
