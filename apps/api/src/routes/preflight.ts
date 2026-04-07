import {
  getCachedDismissedBundleIds,
  refreshDismissedBundleIdsCache,
} from "@versioneer/core/cache";
import { createDb } from "@versioneer/db";
import { Hono } from "hono";

export const preflightRoutes = new Hono<{ Bindings: Env }>()
  // GET /v1/client/preflight
  .get("/client/preflight", async (c) => {
    const cached = await getCachedDismissedBundleIds(c.env.CONFIG_KV);
    if (cached) {
      return c.json({ dismissedBundleIds: cached });
    }

    const db = createDb(c.env.DB);
    const dismissedBundleIds = await refreshDismissedBundleIdsCache(db, c.env.CONFIG_KV);

    return c.json({ dismissedBundleIds });
  });
