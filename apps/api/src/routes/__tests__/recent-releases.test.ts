import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import { getDb, seedApp, seedLatestRelease, seedRelease, seedSource } from "../../__tests__/seed";
import app from "../../index";

describe("GET /v1/releases/recent", () => {
  beforeEach(async () => {
    await env.CACHE_KV.delete("recent-releases");
  });

  it("returns empty items with no releases", async () => {
    const res = await app.request("/v1/releases/recent", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toEqual([]);
  });

  it("returns recent releases sorted by date", async () => {
    const db = getDb(env.DB);
    const appA = await seedApp(db, { canonicalName: "App A", vendorName: "Vendor A" });
    const appB = await seedApp(db, { canonicalName: "App B", vendorName: "Vendor B" });

    const sourceA = await seedSource(db, appA.id);
    const sourceB = await seedSource(db, appB.id);

    const relA = await seedRelease(db, appA.id, {
      versionRaw: "2.0.0",
      versionNormalized: "0000002.0000000.0000000",
      releasedAt: "2026-01-01T00:00:00Z",
      publishedBySourceId: sourceA.id,
    });
    const relB = await seedRelease(db, appB.id, {
      versionRaw: "3.0.0",
      versionNormalized: "0000003.0000000.0000000",
      releasedAt: "2026-02-01T00:00:00Z",
      publishedBySourceId: sourceB.id,
    });

    await seedLatestRelease(db, {
      appId: appA.id,
      releaseId: relA.id,
      authoritySourceId: sourceA.id,
      versionNormalized: relA.versionNormalized,
      versionRaw: relA.versionRaw,
      releasedAt: relA.releasedAt!,
    });
    await seedLatestRelease(db, {
      appId: appB.id,
      releaseId: relB.id,
      authoritySourceId: sourceB.id,
      versionNormalized: relB.versionNormalized,
      versionRaw: relB.versionRaw,
      releasedAt: relB.releasedAt!,
    });

    const res = await app.request("/v1/releases/recent", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { appName: string; version: string }[] };
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    // Most recent first
    expect(body.items[0]!.appName).toBe("App B");
  });
});
