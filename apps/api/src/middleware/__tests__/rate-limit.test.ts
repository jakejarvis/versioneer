import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import { clientRateLimit } from "../rate-limit";

function testApp() {
  const app = new Hono<{ Bindings: Env }>();
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
  it("keys requests by hashed Cloudflare client IP", async () => {
    const keys: string[] = [];
    const app = testApp();

    const response = await app.request(
      "/test",
      {
        method: "POST",
        headers: {
          "cf-connecting-ip": "203.0.113.10",
        },
      },
      envWithRateLimit(keys),
    );

    expect(response.status).toBe(200);
    expect(keys[0]).toMatch(/^client:ip:/);
    expect(keys[0]).not.toContain("203.0.113.10");
  });

  it("uses x-forwarded-for when the Cloudflare header is absent", async () => {
    const keys: string[] = [];
    const app = testApp();

    const response = await app.request(
      "/test",
      {
        method: "POST",
        headers: {
          "x-forwarded-for": "203.0.113.10, 198.51.100.4",
        },
      },
      envWithRateLimit(keys),
    );

    expect(response.status).toBe(200);
    expect(keys[0]).toMatch(/^client:ip:/);
    expect(keys[0]).not.toContain("203.0.113.10");
  });

  it("falls back to an anonymous bucket when no client address is available", async () => {
    const keys: string[] = [];
    const app = testApp();

    const response = await app.request("/test", { method: "POST" }, envWithRateLimit(keys));

    expect(response.status).toBe(200);
    expect(keys).toEqual(["client:anonymous"]);
  });
});
