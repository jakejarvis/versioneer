import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

export interface RateLimitOptions {
  prefix: string;
  limit: number;
  windowSeconds: number;
}

export function createRateLimit(options: RateLimitOptions) {
  return createMiddleware<{ Bindings: Env }>(async (c, next) => {
    const ip =
      c.req.header("cf-connecting-ip") ??
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ??
      "unknown";
    const bucket = Math.floor(Date.now() / (options.windowSeconds * 1000));
    const key = `rate:${options.prefix}:${bucket}:${ip}`;
    const count = Number((await c.env.CACHE_KV.get(key)) ?? "0");

    if (count >= options.limit) {
      throw new HTTPException(429, {
        message: "Too many requests, please retry later",
      });
    }

    await c.env.CACHE_KV.put(key, String(count + 1), {
      expirationTtl: options.windowSeconds * 2,
    });

    await next();
  });
}

export const telemetryRateLimit = createRateLimit({
  prefix: "telemetry",
  limit: 300,
  windowSeconds: 60,
});
