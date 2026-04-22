import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { feedbackUpdateSchema } from "@versioneer/core/validation";
import { createDb } from "@versioneer/db";
import { auditLog, clientFeedback, generateId, idPrefixes } from "@versioneer/db";

import { loadAppsByIds, toAppSummary } from "./entity-summaries";
import { authMiddleware } from "./middleware";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function feedbackOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "feedbackType":
      return [direction(clientFeedback.feedbackType), desc(clientFeedback.createdAt)];
    case "status":
      return [direction(clientFeedback.status), desc(clientFeedback.createdAt)];
    case "createdAt":
    default:
      return [desc(clientFeedback.createdAt)];
  }
}

export const listFeedback = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      status: z.string().optional(),
      feedbackType: z.string().optional(),
      targetAppId: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
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
      .orderBy(...feedbackOrderBy(data.sortBy, data.sortDir))
      .limit(limit)
      .offset(offset);
    const appMap = await loadAppsByIds(
      db,
      items.map((item) => item.targetAppId),
    );

    return {
      items: items.map((item) =>
        Object.assign({}, item, {
          targetApp:
            item.targetAppId && appMap.get(item.targetAppId)
              ? toAppSummary(appMap.get(item.targetAppId)!)
              : null,
        }),
      ),
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  });

export const getFeedbackDetail = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
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

export const getFeedbackStats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
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
