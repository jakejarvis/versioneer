import { and, desc, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";

import {
  getCachedRecentReleases,
  setCachedRecentReleases,
  type CachedRecentRelease,
} from "@versioneer/core/cache";
import { displayVersion } from "@versioneer/core/versioning";
import { createDb } from "@versioneer/db";
import { apps, appLatestReleases } from "@versioneer/db";

export const recentReleasesRoutes = new Hono<{ Bindings: Env }>()
  // GET /v1/releases/recent
  .get("/releases/recent", async (c) => {
    const cached = await getCachedRecentReleases(c.env.CACHE_KV);
    if (cached) {
      c.header("Cache-Control", "public, max-age=300, s-maxage=3600");
      return c.json({ items: cached });
    }

    const db = createDb(c.env.DB);

    const rows = await db
      .select({
        appId: apps.id,
        appName: apps.canonicalName,
        appSlug: apps.slug,
        vendorName: apps.vendorName,
        iconR2Key: apps.iconR2Key,
        releaseId: appLatestReleases.releaseId,
        version: appLatestReleases.versionRaw,
        releasedAt: appLatestReleases.releasedAt,
      })
      .from(appLatestReleases)
      .innerJoin(apps, eq(apps.id, appLatestReleases.appId))
      .where(
        and(
          eq(apps.status, "public"),
          eq(appLatestReleases.channel, "stable"),
          isNotNull(appLatestReleases.releasedAt),
        ),
      )
      .orderBy(desc(appLatestReleases.releasedAt))
      .limit(64)
      .all();

    const rowsByApp = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      if (!rowsByApp.has(row.appId)) rowsByApp.set(row.appId, row);
    }

    const items: CachedRecentRelease[] = [...rowsByApp.values()].slice(0, 8).map((row) => ({
      appId: row.appId,
      appName: row.appName,
      appSlug: row.appSlug,
      vendorName: row.vendorName,
      iconUrl: row.iconR2Key ? `${c.env.ASSETS_BASE_URL}/${row.iconR2Key}` : null,
      releaseId: row.releaseId,
      version: displayVersion(row.version),
      releasedAt: row.releasedAt!,
    }));

    await setCachedRecentReleases(c.env.CACHE_KV, items);

    c.header("Cache-Control", "public, max-age=300, s-maxage=3600");
    return c.json({ items });
  });
