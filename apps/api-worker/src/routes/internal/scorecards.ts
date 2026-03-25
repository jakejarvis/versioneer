import { createDb } from "@versioneer/db";
import { handleComputeScorecard } from "@versioneer/pipeline";
import { apps, appScorecards, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { paginationSchema } from "@versioneer/validation";
import { eq, and, sql, desc } from "drizzle-orm";
import { Hono } from "hono";

import type { AppEnv } from "../../env";

export const scorecardsRoutes = new Hono<AppEnv>();

// GET /scorecards - list
scorecardsRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const qualityState = c.req.query("qualityState");
  const verificationTier = c.req.query("verificationTier");

  const conditions = [];
  if (qualityState)
    conditions.push(eq(apps.qualityState, qualityState as "green" | "yellow" | "red" | "unknown"));
  if (verificationTier)
    conditions.push(
      eq(apps.verificationTier, verificationTier as "unverified" | "provisional" | "verified"),
    );

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const items = await db
    .select({
      app: apps,
      scorecard: appScorecards,
    })
    .from(apps)
    .leftJoin(appScorecards, eq(apps.id, appScorecards.appId))
    .where(where)
    .orderBy(desc(apps.updatedAt))
    .limit(limit)
    .offset(offset);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(apps)
    .where(where);

  return c.json({
    items: items.map((row) => Object.assign({}, row.app, { scorecard: row.scorecard })),
    total: countResult?.count ?? 0,
    limit,
    offset,
  });
});

// GET /scorecards/:appId
scorecardsRoutes.get("/:appId", async (c) => {
  const db = createDb(c.env.DB);
  const appId = c.req.param("appId");

  const scorecard = await db
    .select()
    .from(appScorecards)
    .where(eq(appScorecards.appId, appId))
    .get();

  if (!scorecard) return c.json({ error: "Scorecard not found" }, 404);
  return c.json(scorecard);
});

// POST /scorecards/:appId/recompute
scorecardsRoutes.post("/:appId/recompute", async (c) => {
  const appId = c.req.param("appId");
  await handleComputeScorecard(appId, c.env);
  return c.json({ status: "recomputed", appId });
});

// POST /scorecards/:appId/promote
scorecardsRoutes.post("/:appId/promote", async (c) => {
  const db = createDb(c.env.DB);
  const appId = c.req.param("appId");
  const now = new Date().toISOString();

  const app = await db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) return c.json({ error: "App not found" }, 404);

  let newTier: "provisional" | "verified";
  if (app.verificationTier === "unverified") {
    newTier = "provisional";
  } else if (app.verificationTier === "provisional") {
    newTier = "verified";
  } else {
    return c.json({ error: "App is already verified" }, 400);
  }

  await db
    .update(apps)
    .set({ verificationTier: newTier, updatedAt: now })
    .where(eq(apps.id, appId));

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "verification_promoted",
    actorType: "admin",
    actorId: c.get("user").email,
    targetType: "app",
    targetId: appId,
    payloadJson: JSON.stringify({ from: app.verificationTier, to: newTier }),
    createdAt: now,
  });

  return c.json({ status: "promoted", verificationTier: newTier });
});
