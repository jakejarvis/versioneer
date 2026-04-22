import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vite-plus/test";

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

  it("returns recent releases sorted by parsed timestamp", async () => {
    const db = getDb(env.DB);
    const appA = await seedApp(db, { canonicalName: "App A", vendorName: "Vendor A" });
    const appB = await seedApp(db, { canonicalName: "App B", vendorName: "Vendor B" });

    const sourceA = await seedSource(db, appA.id);
    const sourceB = await seedSource(db, appB.id);

    const relA = await seedRelease(db, appA.id, {
      versionRaw: "2.0.0",
      versionNormalized: "0000002.0000000.0000000",
      releasedAt: "Wed, 11 Feb 2026 06:36:00 +0000",
      publishedBySourceId: sourceA.id,
    });
    const relB = await seedRelease(db, appB.id, {
      versionRaw: "3.0.0",
      versionNormalized: "0000003.0000000.0000000",
      releasedAt: "2026-04-22T20:00:53.512Z",
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
    const body = (await res.json()) as {
      items: { appName: string; version: string; releasedAt: string }[];
    };
    expect(body.items.length).toBeGreaterThanOrEqual(2);
    // Most recent first
    expect(body.items[0]!.appName).toBe("App B");
    expect(body.items.find((item) => item.appName === "App A")?.releasedAt).toBe(
      "2026-02-11T06:36:00.000Z",
    );
  });

  it("uses normalized cached recent releases", async () => {
    await env.CACHE_KV.put(
      "recent-releases",
      JSON.stringify([
        {
          appId: "app-new",
          appName: "New App",
          appSlug: "new-app",
          vendorName: null,
          iconUrl: null,
          releaseId: "rel-new",
          version: "2.0.0",
          releasedAt: "2026-04-22T20:00:53.512Z",
        },
        {
          appId: "app-old",
          appName: "Old App",
          appSlug: "old-app",
          vendorName: null,
          iconUrl: null,
          releaseId: "rel-old",
          version: "1.0.0",
          releasedAt: "2026-02-11T06:36:00.000Z",
        },
      ]),
    );

    const res = await app.request("/v1/releases/recent", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { appName: string; releasedAt: string }[] };
    expect(body.items.map((item) => item.appName)).toEqual(["New App", "Old App"]);
    expect(body.items[1]!.releasedAt).toBe("2026-02-11T06:36:00.000Z");
  });

  it("rebuilds stale recent release cache entries from D1", async () => {
    const db = getDb(env.DB);
    const appA = await seedApp(db, { canonicalName: "Fresh Older", vendorName: "Vendor A" });
    const appB = await seedApp(db, { canonicalName: "Fresh Newer", vendorName: "Vendor B" });

    const relA = await seedRelease(db, appA.id, {
      versionRaw: "1.0.0",
      versionNormalized: "0000001.0000000.0000000",
      releasedAt: "2029-01-01T00:00:00Z",
    });
    const relB = await seedRelease(db, appB.id, {
      versionRaw: "2.0.0",
      versionNormalized: "0000002.0000000.0000000",
      releasedAt: "2029-02-01T00:00:00Z",
    });

    await seedLatestRelease(db, {
      appId: appA.id,
      releaseId: relA.id,
      versionNormalized: relA.versionNormalized,
      versionRaw: relA.versionRaw,
      releasedAt: relA.releasedAt!,
    });
    await seedLatestRelease(db, {
      appId: appB.id,
      releaseId: relB.id,
      versionNormalized: relB.versionNormalized,
      versionRaw: relB.versionRaw,
      releasedAt: relB.releasedAt!,
    });

    await env.CACHE_KV.put(
      "recent-releases",
      JSON.stringify([
        {
          appId: "app-cached-old",
          appName: "Cached Old",
          appSlug: "cached-old",
          vendorName: null,
          iconUrl: null,
          releaseId: "rel-cached-old",
          version: "1.0.0",
          releasedAt: "Wed, 11 Feb 2026 06:36:00 +0000",
        },
        {
          appId: "app-cached-new",
          appName: "Cached New",
          appSlug: "cached-new",
          vendorName: null,
          iconUrl: null,
          releaseId: "rel-cached-new",
          version: "2.0.0",
          releasedAt: "2026-04-22T20:00:53.512Z",
        },
      ]),
    );

    const res = await app.request("/v1/releases/recent", {}, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: { appName: string }[] };
    expect(body.items.map((item) => item.appName).slice(0, 2)).toEqual([
      "Fresh Newer",
      "Fresh Older",
    ]);
  });
});
