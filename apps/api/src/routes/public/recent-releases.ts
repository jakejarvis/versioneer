import {
  getCachedRecentReleases,
  setCachedRecentReleases,
  type CachedRecentRelease,
} from "@versioneer/core/cache";
import { createDb } from "@versioneer/db";
import { apps, appLatestReleases } from "@versioneer/db";
import { and, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";

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
      .all();

    rows.sort(
      (a, b) => new Date(b.releasedAt!).getTime() - new Date(a.releasedAt!).getTime(),
    );

    const items: CachedRecentRelease[] = rows.slice(0, 8).map((row) => ({
      appId: row.appId,
      appName: row.appName,
      appSlug: row.appSlug,
      vendorName: row.vendorName,
      iconUrl: row.iconR2Key ? `${c.env.ASSETS_BASE_URL}/${row.iconR2Key}` : null,
      releaseId: row.releaseId,
      version: row.version,
      releasedAt: row.releasedAt!,
    }));

    await setCachedRecentReleases(c.env.CACHE_KV, items);

    c.header("Cache-Control", "public, max-age=300, s-maxage=3600");
    return c.json({ items });
  });
