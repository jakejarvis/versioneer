import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import {
  reviewQueue,
  appAliases,
  adminOverrides,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { loadEntityRefsByIds } from "./entity-summaries";
import { buildReviewQueueSortDescriptors } from "./list-helpers";
import { authMiddleware } from "./middleware";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function reviewQueueOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const sortColumns = {
    reviewType: reviewQueue.reviewType,
    status: reviewQueue.status,
    createdAt: reviewQueue.createdAt,
    priority: reviewQueue.priority,
  };

  return buildReviewQueueSortDescriptors(sortBy, sortDir).map((descriptor) =>
    (descriptor.dir === "asc" ? asc : desc)(
      sortColumns[descriptor.field as keyof typeof sortColumns],
    ),
  );
}

// GET /review-queue - list with pagination, default status="pending"
export const listReviewQueue = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["pending", "in_progress", "resolved", "dismissed"]).default("pending"),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, status, sortBy, sortDir } = data;
    const db = createDb(env.DB);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(reviewQueue)
      .where(eq(reviewQueue.status, status));
    const items = await db
      .select()
      .from(reviewQueue)
      .where(eq(reviewQueue.status, status))
      .orderBy(...reviewQueueOrderBy(sortBy, sortDir))
      .limit(limit)
      .offset(offset);
    const relatedRefMap = await loadEntityRefsByIds(
      db,
      items.map((item) => item.relatedId),
    );

    return {
      items: items.map((item) =>
        Object.assign({}, item, {
          relatedRef: item.relatedId ? (relatedRefMap.get(item.relatedId) ?? null) : null,
        }),
      ),
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  });

// GET /review-queue/:id - detail
export const getReviewItem = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const item = await db.select().from(reviewQueue).where(eq(reviewQueue.id, id)).get();
    if (!item) throw new Error("Not found");
    return item;
  });

// PATCH /review-queue/:id - update status
export const updateReviewItem = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      id: z.string().min(1),
      status: z.enum(["resolved", "dismissed", "in_progress"]),
    }),
  )
  .handler(async ({ data, context }) => {
    const { id, status: newStatus } = data;
    const db = createDb(env.DB);

    const existing = await db.select().from(reviewQueue).where(eq(reviewQueue.id, id)).get();
    if (!existing) throw new Error("Not found");

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
      actorId: context.user.email,
      targetType: "review_queue",
      targetId: id,
      payloadJson: JSON.stringify({ status: newStatus }),
      createdAt: now,
    });

    return { status: "updated" };
  });

// POST /review-queue/:id/resolve-match - create alias from ambiguous match
export const resolveMatch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      id: z.string().min(1),
      appId: z.string().min(1),
      aliasType: z.enum([
        "bundle_id",
        "name",
        "team_id",
        "sparkle_feed",
        "homepage",
        "download_pattern",
        "github_repo",
        "mas_app_id",
      ]),
      value: z.string().min(1),
    }),
  )
  .handler(async ({ data, context }) => {
    const { id, appId, aliasType, value } = data;
    const db = createDb(env.DB);

    const item = await db.select().from(reviewQueue).where(eq(reviewQueue.id, id)).get();
    if (!item) throw new Error("Not found");

    const now = new Date().toISOString();

    // Create the alias
    const aliasId = generateId(idPrefixes.alias);
    await db.insert(appAliases).values({
      id: aliasId,
      appId,
      aliasType,
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
      actorId: context.user.email,
      targetType: "review_queue",
      targetId: id,
      payloadJson: JSON.stringify({ appId, aliasType, value, aliasId }),
      createdAt: now,
    });

    return { status: "resolved", aliasId };
  });

// POST /review-queue/:id/approve-publication - allow gated publication
export const approvePublication = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id }, context }) => {
    const db = createDb(env.DB);
    const item = await db.select().from(reviewQueue).where(eq(reviewQueue.id, id)).get();
    if (!item) throw new Error("Not found");

    const now = new Date().toISOString();
    const payload = item.payloadJson ? JSON.parse(item.payloadJson) : {};
    const appId = payload.appId ?? item.relatedId;
    const channel = payload.channel ?? "stable";

    if (!appId) throw new Error("Cannot determine appId from review item");

    // Create override to force publication
    const overrideId = generateId(idPrefixes.adminOverride);
    await db.insert(adminOverrides).values({
      id: overrideId,
      overrideType: "approve_publication",
      targetType: "app_latest",
      targetId: `${appId}:${channel}`,
      payloadJson: payload.releaseId ? JSON.stringify({ releaseId: payload.releaseId }) : "{}",
      reason: "Approved via review queue",
      createdBy: context.user.email,
      isActive: true,
      createdAt: now,
    });

    // Resolve the review item
    await db
      .update(reviewQueue)
      .set({ status: "resolved", resolvedAt: now })
      .where(eq(reviewQueue.id, id));

    // Trigger recompute
    await env.RECOMPUTE_LATEST_QUEUE.send({ appId, channel });

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "publication_approved",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "review_queue",
      targetId: id,
      payloadJson: JSON.stringify({ appId, channel, overrideId }),
      createdAt: now,
    });

    return { status: "approved", overrideId };
  });
