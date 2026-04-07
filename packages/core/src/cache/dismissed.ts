import { and, eq, isNotNull } from "drizzle-orm";

import type { Database } from "@versioneer/db";
import { discoveredApps } from "@versioneer/db";

import { setCachedDismissedBundleIds } from "./helpers";
import type { CacheKV } from "./types";

/**
 * Queries all dismissed bundle IDs from D1 and writes them to KV cache.
 * Returns the list of dismissed bundle IDs.
 */
export async function refreshDismissedBundleIdsCache(db: Database, kv: CacheKV): Promise<string[]> {
  const rows = await db
    .select({ bundleId: discoveredApps.bundleId })
    .from(discoveredApps)
    .where(and(eq(discoveredApps.status, "dismissed"), isNotNull(discoveredApps.bundleId)))
    .all();

  const ids = [...new Set(rows.map((r) => r.bundleId).filter((id): id is string => id !== null))];

  await setCachedDismissedBundleIds(kv, ids);
  return ids;
}
