import { createDb } from "@versioneer/db";
import { apps, releases } from "@versioneer/schema";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../../env";

export const appsRoutes = new Hono<{ Bindings: Env }>()
  // GET /v1/apps/:appId
  .get("/apps/:appId", async (c) => {
    const appId = c.req.param("appId");
    const db = createDb(c.env.DB);

    const app = await db.select().from(apps).where(eq(apps.id, appId)).get();
    if (!app) {
      return c.json({ error: "App not found" }, 404);
    }

    const iconUrl = app.iconR2Key ? `${c.env.ASSETS_BASE_URL}/${app.iconR2Key}` : null;
    return c.json({ ...app, iconUrl });
  })
  // GET /v1/apps/:appId/releases
  .get("/apps/:appId/releases", async (c) => {
    const appId = c.req.param("appId");
    const db = createDb(c.env.DB);

    const appReleases = await db.select().from(releases).where(eq(releases.appId, appId)).all();

    return c.json({ releases: appReleases });
  })
  // GET /v1/releases/:releaseId/notes
  .get("/releases/:releaseId/notes", async (c) => {
    const releaseId = c.req.param("releaseId");
    const db = createDb(c.env.DB);

    const release = await db
      .select({
        id: releases.id,
        appId: releases.appId,
        versionRaw: releases.versionRaw,
        releaseNotesHtml: releases.releaseNotesHtml,
      })
      .from(releases)
      .where(eq(releases.id, releaseId))
      .get();

    if (!release) {
      return c.json({ error: "Release not found" }, 404);
    }

    return c.json({
      releaseId: release.id,
      appId: release.appId,
      versionRaw: release.versionRaw,
      releaseNotesHtml: release.releaseNotesHtml,
    });
  });
