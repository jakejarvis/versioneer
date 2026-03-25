import { createDb } from "@versioneer/db";
import { clientFeedback, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { paginationSchema, feedbackUpdateSchema } from "@versioneer/validation";
import { eq, and, sql, desc } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../../env";

export const feedbackRoutes = new Hono<{ Bindings: Env }>();

// GET /feedback - list
feedbackRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const status = c.req.query("status");
  const feedbackType = c.req.query("feedbackType");
  const targetAppId = c.req.query("targetAppId");

  const conditions = [];
  if (status)
    conditions.push(
      eq(clientFeedback.status, status as "new" | "triaged" | "resolved" | "dismissed"),
    );
  if (feedbackType)
    conditions.push(
      eq(
        clientFeedback.feedbackType,
        feedbackType as "wrong_match" | "wrong_version" | "app_request" | "general",
      ),
    );
  if (targetAppId) conditions.push(eq(clientFeedback.targetAppId, targetAppId));

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

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});

// GET /feedback/:id
feedbackRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const item = await db.select().from(clientFeedback).where(eq(clientFeedback.id, id)).get();
  if (!item) return c.json({ error: "Feedback not found" }, 404);
  return c.json(item);
});

// PATCH /feedback/:id
feedbackRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = feedbackUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const existing = await db.select().from(clientFeedback).where(eq(clientFeedback.id, id)).get();
  if (!existing) return c.json({ error: "Feedback not found" }, 404);

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status: parsed.data.status };
  if (parsed.data.status === "resolved" || parsed.data.status === "dismissed") {
    updates.resolvedAt = now;
  }

  await db.update(clientFeedback).set(updates).where(eq(clientFeedback.id, id));

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "feedback_updated",
    actorType: "admin",
    actorId: null,
    targetType: "feedback",
    targetId: id,
    payloadJson: JSON.stringify({ status: parsed.data.status }),
    createdAt: now,
  });

  return c.json({ status: "updated" });
});

// GET /feedback/stats
feedbackRoutes.get("/stats", async (c) => {
  const db = createDb(c.env.DB);

  const [newCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(clientFeedback)
    .where(eq(clientFeedback.status, "new"));
  const [triagedCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(clientFeedback)
    .where(eq(clientFeedback.status, "triaged"));

  return c.json({
    new: newCount?.count ?? 0,
    triaged: triagedCount?.count ?? 0,
  });
});
