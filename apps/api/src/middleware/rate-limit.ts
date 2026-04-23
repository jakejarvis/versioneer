import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

export interface RateLimitOptions {
  prefix: string;
}

function requestAddress(c: Context<{ Bindings: Env }>): string | null {
  const cloudflareIp = c.req.header("cf-connecting-ip")?.trim();
  if (cloudflareIp) return cloudflareIp;

  const forwardedFor = c.req.header("x-forwarded-for");
  if (!forwardedFor) return null;

  const firstAddress = forwardedFor.split(",")[0]?.trim();
  return firstAddress && firstAddress.length > 0 ? firstAddress : null;
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
  const clientAddress = requestAddress(c);
  if (clientAddress) return `${prefix}:ip:${await hashKeyPart(clientAddress)}`;

  return `${prefix}:anonymous`;
}

export function createRateLimit(options: RateLimitOptions) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
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
