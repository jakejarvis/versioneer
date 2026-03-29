import { createDb } from "@versioneer/db";
import { apps, releases } from "@versioneer/db";
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { Env } from "../../env";

export const appsRoutes = new Hono<{ Bindings: Env }>()
  // GET /v1/apps/:appId
  .get("/apps/:appId", async (c) => {
    const appId = c.req.param("appId");
    const db = createDb(c.env.DB);

    const app = await db.select().from(apps).where(eq(apps.id, appId)).get();
    if (!app || app.status !== "public") {
      throw new HTTPException(404, { message: "App not found" });
    }

    const iconUrl = app.iconR2Key ? `${c.env.ASSETS_BASE_URL}/${app.iconR2Key}` : null;
    return c.json({ ...app, iconUrl });
  })
  // GET /v1/apps/:appId/releases
  .get("/apps/:appId/releases", async (c) => {
    const appId = c.req.param("appId");
    const db = createDb(c.env.DB);

    const appReleases = await db.select().from(releases).where(eq(releases.appId, appId)).all();
    const app = await db.select().from(apps).where(eq(apps.id, appId)).get();
    if (!app || app.status !== "public") {
      throw new HTTPException(404, { message: "App not found" });
    }

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
        releaseNotesUrl: releases.releaseNotesUrl,
        appDefaultReleaseNotesUrl: apps.defaultReleaseNotesUrl,
      })
      .from(releases)
      .innerJoin(apps, eq(apps.id, releases.appId))
      .where(eq(releases.id, releaseId))
      .get();

    if (!release) {
      throw new HTTPException(404, { message: "Release not found" });
    }

    return c.json({
      releaseId: release.id,
      appId: release.appId,
      versionRaw: release.versionRaw,
      releaseNotesHtml: release.releaseNotesHtml,
      releaseNotesUrl: release.releaseNotesUrl ?? release.appDefaultReleaseNotesUrl,
    });
  });
