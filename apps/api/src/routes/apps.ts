import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import { createDb } from "@versioneer/db";
import { apps, releases } from "@versioneer/db";

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

    const app = await db.select().from(apps).where(eq(apps.id, appId)).get();
    if (!app || app.status !== "public") {
      throw new HTTPException(404, { message: "App not found" });
    }

    const appReleases = await db
      .select()
      .from(releases)
      .where(and(eq(releases.appId, appId), eq(releases.status, "active")))
      .all();

    return c.json({
      releases: appReleases.map((release) =>
        Object.assign({}, release, {
          releaseNotesHtml: release.releaseNotesMarkdown ? null : release.releaseNotesHtml,
        }),
      ),
    });
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
        releaseNotesMarkdown: releases.releaseNotesMarkdown,
        releaseNotesHtml: releases.releaseNotesHtml,
        releaseNotesUrl: releases.releaseNotesUrl,
        appDefaultReleaseNotesUrl: apps.defaultReleaseNotesUrl,
        appStatus: apps.status,
      })
      .from(releases)
      .innerJoin(apps, eq(apps.id, releases.appId))
      .where(eq(releases.id, releaseId))
      .get();

    if (!release || release.appStatus !== "public") {
      throw new HTTPException(404, { message: "Release not found" });
    }

    return c.json({
      releaseId: release.id,
      appId: release.appId,
      versionRaw: release.versionRaw,
      releaseNotesMarkdown: release.releaseNotesMarkdown,
      releaseNotesHtml: release.releaseNotesMarkdown ? null : release.releaseNotesHtml,
      releaseNotesUrl: release.releaseNotesUrl ?? release.appDefaultReleaseNotesUrl,
    });
  });
