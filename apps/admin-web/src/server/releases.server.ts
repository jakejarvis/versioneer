import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import {
  releases,
  artifacts,
  releaseObservations,
  adminOverrides,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { releaseUpdateSchema } from "@versioneer/validation";
import { env } from "cloudflare:workers";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

// GET /releases - list with pagination and filters
export const listReleases = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      appId: z.string().optional(),
      channel: z.enum(["stable", "beta", "nightly"]).optional(),
      status: z.enum(["active", "retracted", "superseded", "draft"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, appId, channel, status } = data;
    const db = createDb(env.DB);

    const conditions = [];
    if (appId) conditions.push(eq(releases.appId, appId));
    if (channel) conditions.push(eq(releases.channel, channel));
    if (status) conditions.push(eq(releases.status, status));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(releases)
      .where(where);
    const items = await db
      .select()
      .from(releases)
      .where(where)
      .orderBy(desc(releases.createdAt))
      .limit(limit)
      .offset(offset);

    return { items, total: countResult?.count ?? 0, limit, offset };
  });

// GET /releases/:id - detail
export const getRelease = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const release = await db.select().from(releases).where(eq(releases.id, id)).get();
    if (!release) throw new Error("Not found");
    return release;
  });

// PATCH /releases/:id - update status/channel
export const updateRelease = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(releaseUpdateSchema.extend({ id: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const { id, ...fields } = data;
    const db = createDb(env.DB);

    const existing = await db.select().from(releases).where(eq(releases.id, id)).get();
    if (!existing) throw new Error("Not found");

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (fields.status !== undefined) updates.status = fields.status;
    if (fields.channel !== undefined) updates.channel = fields.channel;

    await db.update(releases).set(updates).where(eq(releases.id, id));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "release_updated",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "release",
      targetId: id,
      payloadJson: JSON.stringify(fields),
      createdAt: now,
    });

    return { status: "updated" };
  });

// GET /releases/:id/artifacts
export const getReleaseArtifacts = createServerFn({ method: "GET" })
  .inputValidator(z.object({ releaseId: z.string().min(1) }))
  .handler(async ({ data: { releaseId } }) => {
    const db = createDb(env.DB);
    const items = await db.select().from(artifacts).where(eq(artifacts.releaseId, releaseId)).all();
    return { items };
  });

// POST /artifacts/:id/verify - send to verify queue
export const verifyArtifact = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ artifactId: z.string().min(1) }))
  .handler(async ({ data: { artifactId } }) => {
    await env.ARTIFACT_VERIFY_QUEUE.send({ artifactId });
    return { status: "queued", artifactId };
  });

// POST /releases/:id/pin - create admin override to pin release
export const pinRelease = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id }, context }) => {
    const db = createDb(env.DB);
    const release = await db.select().from(releases).where(eq(releases.id, id)).get();
    if (!release) throw new Error("Not found");

    const now = new Date().toISOString();
    const targetId = `${release.appId}:${release.channel}`;

    // Deactivate existing pin overrides for this app+channel
    const existing = await db
      .select()
      .from(adminOverrides)
      .where(
        and(
          eq(adminOverrides.targetType, "app_latest"),
          eq(adminOverrides.targetId, targetId),
          eq(adminOverrides.isActive, true),
        ),
      )
      .all();
    for (const ovr of existing) {
      await db.update(adminOverrides).set({ isActive: false }).where(eq(adminOverrides.id, ovr.id));
    }

    await db.insert(adminOverrides).values({
      id: generateId(idPrefixes.adminOverride),
      overrideType: "pin_latest_release",
      targetType: "app_latest",
      targetId,
      payloadJson: JSON.stringify({ releaseId: id }),
      reason: "Pinned via admin UI",
      createdBy: context.user.email,
      isActive: true,
      createdAt: now,
    });

    await env.RECOMPUTE_LATEST_QUEUE.send({ appId: release.appId, channel: release.channel });

    return { status: "pinned" };
  });

// POST /releases/:id/unpin - deactivate pin overrides
export const unpinRelease = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const release = await db.select().from(releases).where(eq(releases.id, id)).get();
    if (!release) throw new Error("Not found");

    const targetId = `${release.appId}:${release.channel}`;
    const overrides = await db
      .select()
      .from(adminOverrides)
      .where(
        and(
          eq(adminOverrides.targetType, "app_latest"),
          eq(adminOverrides.targetId, targetId),
          eq(adminOverrides.isActive, true),
        ),
      )
      .all();

    for (const ovr of overrides) {
      await db.update(adminOverrides).set({ isActive: false }).where(eq(adminOverrides.id, ovr.id));
    }

    await env.RECOMPUTE_LATEST_QUEUE.send({ appId: release.appId, channel: release.channel });

    return { status: "unpinned" };
  });

// GET /releases/:id/observations
export const getReleaseObservations = createServerFn({ method: "GET" })
  .inputValidator(z.object({ releaseId: z.string().min(1) }))
  .handler(async ({ data: { releaseId } }) => {
    const db = createDb(env.DB);
    const items = await db
      .select()
      .from(releaseObservations)
      .where(eq(releaseObservations.releaseId, releaseId))
      .orderBy(desc(releaseObservations.createdAt))
      .all();
    return { items };
  });
