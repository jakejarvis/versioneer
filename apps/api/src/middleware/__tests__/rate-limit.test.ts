import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import { clientRateLimit } from "../rate-limit";

function testApp(params: { jwtPayload?: unknown } = {}) {
  const app = new Hono<{ Bindings: Env }>();
  if ("jwtPayload" in params) {
    app.use("*", async (c, next) => {
      c.set("jwtPayload", params.jwtPayload);
      await next();
    });
  }
  app.post("/test", clientRateLimit, (c) => c.text("ok"));
  return app;
}

function envWithRateLimit(keys: string[], success = true): Env {
  return {
    CLIENT_RATE_LIMITER: {
      async limit({ key }) {
        keys.push(key);
        return { success };
      },
    },
  } as Env;
}

describe("clientRateLimit", () => {
  it("keys protected desktop requests by verified App Attest device id", async () => {
    const keys: string[] = [];
    const app = testApp({ jwtPayload: { sub: "device_123" } });

    const response = await app.request("/test", { method: "POST" }, envWithRateLimit(keys));

    expect(response.status).toBe(200);
    expect(keys).toEqual(["client:device:device_123"]);
  });

  it("does not use IP headers when an Authorization fallback is available", async () => {
    const keys: string[] = [];
    const app = testApp();

    const response = await app.request(
      "/test",
      {
        method: "POST",
        headers: {
          Authorization: "Bearer local-dev-token",
          "cf-connecting-ip": "203.0.113.10",
        },
      },
      envWithRateLimit(keys),
    );

    expect(response.status).toBe(200);
    expect(keys[0]).toMatch(/^client:auth:/);
    expect(keys[0]).not.toContain("203.0.113.10");
    expect(keys[0]).not.toContain("local-dev-token");
  });

  it("silently bypasses the limiter when attestation is globally disabled", async () => {
    const keys: string[] = [];
    const app = testApp();
    const rateLimitEnv = envWithRateLimit(keys, false);

    const response = await app.request("/test", { method: "POST" }, {
      ...rateLimitEnv,
      REQUIRE_ATTESTATION: "false",
    } as Env);

    expect(response.status).toBe(200);
    expect(keys).toEqual([]);
  });
});
