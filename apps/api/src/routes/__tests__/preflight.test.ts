import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb, seedDiscoveredApp } from "../../__tests__/seed";
import app from "../../index";

describe("GET /v1/client/preflight", () => {
  beforeEach(async () => {
    // Clear CONFIG_KV cache between tests
    await env.CONFIG_KV.delete("dismissed-bundle-ids");
  });

  it("returns empty array with no dismissed apps", async () => {
    const res = await app.request("/v1/client/preflight", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dismissedBundleIds: string[] };
    expect(body.dismissedBundleIds).toEqual([]);
  });

  it("returns dismissed bundle IDs", async () => {
    const db = getDb(env.DB);
    await seedDiscoveredApp(db, {
      bundleId: "com.dismissed.app",
      status: "dismissed",
    });
    const res = await app.request("/v1/client/preflight", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dismissedBundleIds: string[] };
    expect(body.dismissedBundleIds).toContain("com.dismissed.app");
  });
});
