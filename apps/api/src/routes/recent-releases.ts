import { and, eq, isNotNull } from "drizzle-orm";
import { Hono } from "hono";

import {
  getCachedRecentReleases,
  setCachedRecentReleases,
  type CachedRecentRelease,
} from "@versioneer/core/cache";
import { toEpochMs, toISODate } from "@versioneer/core/dates";
import { displayVersion } from "@versioneer/core/versioning";
import { createDb } from "@versioneer/db";
import { apps, appLatestReleases } from "@versioneer/db";

type SortableRecentRelease = CachedRecentRelease & { sortTimestamp: number };

function parseReleaseDate(
  value: string | null | undefined,
): { iso: string; timestamp: number } | null {
  const iso = toISODate(value);
  if (!iso) return null;
  const timestamp = toEpochMs(iso);
  if (timestamp === null) return null;
  return {
    iso,
    timestamp,
  };
}

function compareRecentReleases(a: SortableRecentRelease, b: SortableRecentRelease): number {
  if (b.sortTimestamp !== a.sortTimestamp) return b.sortTimestamp - a.sortTimestamp;

  const appNameOrder = a.appName.localeCompare(b.appName);
  if (appNameOrder !== 0) return appNameOrder;

  return a.releaseId.localeCompare(b.releaseId);
}

function sortRecentReleases(items: CachedRecentRelease[]): CachedRecentRelease[] {
  const sortable: SortableRecentRelease[] = [];

  for (const item of items) {
    const parsed = parseReleaseDate(item.releasedAt);
    if (!parsed) continue;
    sortable.push({
      ...item,
      releasedAt: parsed.iso,
      sortTimestamp: parsed.timestamp,
    });
  }

  return sortable
    .sort(compareRecentReleases)
    .map(({ sortTimestamp: _sortTimestamp, ...item }) => item);
}

function cacheMatchesSortedItems(
  cached: CachedRecentRelease[],
  sorted: CachedRecentRelease[],
): boolean {
  if (cached.length !== sorted.length) return false;

  return cached.every((item, index) => {
    const sortedItem = sorted[index];
    if (!sortedItem) return false;
    return (
      item.releaseId === sortedItem.releaseId &&
      parseReleaseDate(item.releasedAt)?.iso === sortedItem.releasedAt
    );
  });
}

export const recentReleasesRoutes = new Hono<{ Bindings: Env }>()
  // GET /v1/releases/recent
  .get("/releases/recent", async (c) => {
    const cached = await getCachedRecentReleases(c.env.CACHE_KV);
    if (cached) {
      const items = sortRecentReleases(cached).slice(0, 8);
      if (cacheMatchesSortedItems(cached, items)) {
        c.header("Cache-Control", "public, max-age=300, s-maxage=3600");
        return c.json({ items });
      }
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

    const sortedRows = sortRecentReleases(
      rows.flatMap((row) => {
        const parsed = parseReleaseDate(row.releasedAt);
        if (!parsed) return [];
        return [
          {
            appId: row.appId,
            appName: row.appName,
            appSlug: row.appSlug,
            vendorName: row.vendorName,
            iconUrl: row.iconR2Key ? `${c.env.ASSETS_BASE_URL}/${row.iconR2Key}` : null,
            releaseId: row.releaseId,
            version: displayVersion(row.version),
            releasedAt: parsed.iso,
          },
        ];
      }),
    );

    const itemsByApp = new Map<string, CachedRecentRelease>();
    for (const row of sortedRows) {
      if (!itemsByApp.has(row.appId)) itemsByApp.set(row.appId, row);
    }

    const items = [...itemsByApp.values()].slice(0, 8);

    await setCachedRecentReleases(c.env.CACHE_KV, items);

    c.header("Cache-Control", "public, max-age=300, s-maxage=3600");
    return c.json({ items });
  });
