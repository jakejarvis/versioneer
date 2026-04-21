import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

import app from "../../index";

describe("GET /health", () => {
  it("returns ok with environment", async () => {
    const res = await app.request("/health", {}, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", environment: "dev" });
  });
});
