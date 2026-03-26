import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { clientFeedback, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { feedbackUpdateSchema } from "@versioneer/validation";
import { env } from "cloudflare:workers";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

export const listFeedback = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      status: z.string().optional(),
      feedbackType: z.string().optional(),
      targetAppId: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    const conditions = [];
    if (data.status)
      conditions.push(
        eq(clientFeedback.status, data.status as "new" | "triaged" | "resolved" | "dismissed"),
      );
    if (data.feedbackType)
      conditions.push(
        eq(
          clientFeedback.feedbackType,
          data.feedbackType as "wrong_match" | "wrong_version" | "app_request" | "general",
        ),
      );
    if (data.targetAppId) conditions.push(eq(clientFeedback.targetAppId, data.targetAppId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clientFeedback)
      .where(where);
    const items = await db
      .select()
      .from(clientFeedback)
      .where(where)
      .orderBy(desc(clientFeedback.createdAt))
      .limit(limit)
      .offset(offset);

    return { items, total: countResult?.count ?? 0, limit, offset };
  });

export const getFeedbackDetail = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const item = await db.select().from(clientFeedback).where(eq(clientFeedback.id, data.id)).get();
    if (!item) throw new Error("Not found");
    return item;
  });

export const updateFeedback = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string() }).merge(feedbackUpdateSchema))
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const existing = await db
      .select()
      .from(clientFeedback)
      .where(eq(clientFeedback.id, data.id))
      .get();
    if (!existing) throw new Error("Not found");

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { status: data.status };
    if (data.status === "resolved" || data.status === "dismissed") {
      updates.resolvedAt = now;
    }

    await db.update(clientFeedback).set(updates).where(eq(clientFeedback.id, data.id));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "feedback_updated",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "feedback",
      targetId: data.id,
      payloadJson: JSON.stringify({ status: data.status }),
      createdAt: now,
    });

    return { status: "updated" };
  });

export const getFeedbackStats = createServerFn({ method: "GET" }).handler(async () => {
  const db = createDb(env.DB);

  const [newCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(clientFeedback)
    .where(eq(clientFeedback.status, "new"));
  const [triagedCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(clientFeedback)
    .where(eq(clientFeedback.status, "triaged"));

  return {
    new: newCount?.count ?? 0,
    triaged: triagedCount?.count ?? 0,
  };
});
