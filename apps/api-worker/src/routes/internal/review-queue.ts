import { createDb } from "@versioneer/db";
import {
  reviewQueue,
  appAliases,
  adminOverrides,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { paginationSchema } from "@versioneer/validation";
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

// POST /review-queue/:id/resolve-match - create alias from ambiguous match
reviewQueueRoutes.post("/:id/resolve-match", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const { appId, aliasType, value } = body as {
    appId: string;
    aliasType: string;
    value: string;
  };

  if (!appId || !aliasType || !value) {
    return c.json({ error: "appId, aliasType, and value are required" }, 400);
  }

  const db = createDb(c.env.DB);
  const item = await db.select().from(reviewQueue).where(eq(reviewQueue.id, id)).get();
  if (!item) return c.json({ error: "Review item not found" }, 404);

  const now = new Date().toISOString();

  // Create the alias
  const aliasId = generateId(idPrefixes.alias);
  await db.insert(appAliases).values({
    id: aliasId,
    appId,
    aliasType: aliasType as
      | "bundle_id"
      | "name"
      | "team_id"
      | "sparkle_feed"
      | "homepage"
      | "download_pattern"
      | "github_repo",
    value,
    normalizedValue: value.toLowerCase(),
    isExact: true,
    priority: 10,
    confidenceWeight: 95,
    source: "review_resolution",
    isActive: true,
    createdAt: now,
  });

  // Resolve the review item
  await db
    .update(reviewQueue)
    .set({ status: "resolved", resolvedAt: now })
    .where(eq(reviewQueue.id, id));

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "match_resolved",
    actorType: "admin",
    actorId: null,
    targetType: "review_queue",
    targetId: id,
    payloadJson: JSON.stringify({ appId, aliasType, value, aliasId }),
    createdAt: now,
  });

  return c.json({ status: "resolved", aliasId });
});

// POST /review-queue/:id/approve-publication - allow gated publication
reviewQueueRoutes.post("/:id/approve-publication", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.DB);
  const item = await db.select().from(reviewQueue).where(eq(reviewQueue.id, id)).get();
  if (!item) return c.json({ error: "Review item not found" }, 404);

  const now = new Date().toISOString();
  const payload = item.payloadJson ? JSON.parse(item.payloadJson) : {};
  const appId = payload.appId ?? item.relatedId;
  const channel = payload.channel ?? "stable";

  if (!appId) return c.json({ error: "Cannot determine appId from review item" }, 400);

  // Create override to force publication
  const overrideId = generateId(idPrefixes.adminOverride);
  await db.insert(adminOverrides).values({
    id: overrideId,
    overrideType: "approve_publication",
    targetType: "app_latest",
    targetId: `${appId}:${channel}`,
    payloadJson: payload.releaseId ? JSON.stringify({ releaseId: payload.releaseId }) : "{}",
    reason: "Approved via review queue",
    createdBy: "admin",
    isActive: true,
    createdAt: now,
  });

  // Resolve the review item
  await db
    .update(reviewQueue)
    .set({ status: "resolved", resolvedAt: now })
    .where(eq(reviewQueue.id, id));

  // Trigger recompute
  await c.env.RECOMPUTE_LATEST_QUEUE.send({ appId, channel });

  return c.json({ status: "approved", overrideId });
});
