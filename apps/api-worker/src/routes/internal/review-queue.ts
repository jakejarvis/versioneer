import { createDb } from "@macupdater/db";
import { reviewQueue, auditLog, generateId, idPrefixes } from "@macupdater/schema";
import { paginationSchema } from "@macupdater/validation";
import { eq, sql, desc } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../../env";

export const reviewQueueRoutes = new Hono<{ Bindings: Env }>();

// GET /review-queue - list
reviewQueueRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const status = c.req.query("status") ?? "pending";

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(reviewQueue)
    .where(eq(reviewQueue.status, status as "pending" | "in_progress" | "resolved" | "dismissed"));
  const items = await db
    .select()
    .from(reviewQueue)
    .where(eq(reviewQueue.status, status as "pending" | "in_progress" | "resolved" | "dismissed"))
    .orderBy(desc(reviewQueue.priority), desc(reviewQueue.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});

// GET /review-queue/:id
reviewQueueRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const item = await db.select().from(reviewQueue).where(eq(reviewQueue.id, id)).get();
  if (!item) return c.json({ error: "Review item not found" }, 404);
  return c.json(item);
});

// PATCH /review-queue/:id - resolve/dismiss
reviewQueueRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const newStatus = (body as Record<string, string>).status;

  if (!newStatus || !["resolved", "dismissed", "in_progress"].includes(newStatus)) {
    return c.json({ error: "Invalid status" }, 400);
  }

  const db = createDb(c.env.DB);
  const existing = await db.select().from(reviewQueue).where(eq(reviewQueue.id, id)).get();
  if (!existing) return c.json({ error: "Review item not found" }, 404);

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === "resolved" || newStatus === "dismissed") {
    updates.resolvedAt = now;
  }

  await db.update(reviewQueue).set(updates).where(eq(reviewQueue.id, id));

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "review_item_updated",
    actorType: "admin",
    actorId: null,
    targetType: "review_queue",
    targetId: id,
    payloadJson: JSON.stringify({ status: newStatus }),
    createdAt: now,
  });

  return c.json({ status: "updated" });
});
