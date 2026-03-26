import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { handleComputeScorecard } from "@versioneer/pipeline";
import { apps, appScorecards, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

// GET /scorecards - list with LEFT JOIN apps + appScorecards
export const listScorecards = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      qualityState: z.enum(["green", "yellow", "red", "unknown"]).optional(),
      verificationTier: z.enum(["unverified", "provisional", "verified"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, qualityState, verificationTier } = data;
    const db = createDb(env.DB);

    const conditions = [];
    if (qualityState) conditions.push(eq(apps.qualityState, qualityState));
    if (verificationTier) conditions.push(eq(apps.verificationTier, verificationTier));

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

    return {
      items: items.map((row) => Object.assign({}, row.app, { scorecard: row.scorecard })),
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  });

// GET /scorecards/:appId - detail
export const getScorecard = createServerFn({ method: "GET" })
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data: { appId } }) => {
    const db = createDb(env.DB);
    const scorecard = await db
      .select()
      .from(appScorecards)
      .where(eq(appScorecards.appId, appId))
      .get();
    if (!scorecard) throw new Error("Not found");
    return scorecard;
  });

// POST /scorecards/:appId/recompute - calls pipeline handler
export const recomputeScorecard = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data: { appId } }) => {
    await handleComputeScorecard(appId, env as never);
    return { status: "recomputed", appId };
  });

// POST /scorecards/:appId/promote - promote verification tier
export const promoteVerification = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data: { appId }, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();

    const app = await db.select().from(apps).where(eq(apps.id, appId)).get();
    if (!app) throw new Error("Not found");

    let newTier: "provisional" | "verified";
    if (app.verificationTier === "unverified") {
      newTier = "provisional";
    } else if (app.verificationTier === "provisional") {
      newTier = "verified";
    } else {
      throw new Error("App is already verified");
    }

    await db
      .update(apps)
      .set({ verificationTier: newTier, updatedAt: now })
      .where(eq(apps.id, appId));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "verification_promoted",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "app",
      targetId: appId,
      payloadJson: JSON.stringify({ from: app.verificationTier, to: newTier }),
      createdAt: now,
    });

    return { status: "promoted", verificationTier: newTier };
  });
