import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { sanitizeHtml } from "@versioneer/core/pipeline";
import { releaseCreateSchema, releaseUpdateSchema } from "@versioneer/core/validation";
import { normalizeVersion, isPreRelease, inferChannel } from "@versioneer/core/versioning";
import { createDb } from "@versioneer/db";
import {
  releases,
  artifacts,
  releaseObservations,
  appLatestReleases,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/db";

import { loadAppsByIds, toAppSummary } from "./entity-summaries";
import { scheduleRecomputeLatest } from "./followup-jobs";
import { authMiddleware } from "./middleware";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function releaseOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "versionRaw":
      return [direction(releases.versionNormalized), direction(releases.versionRaw)];
    case "channel":
      return [direction(releases.channel), desc(releases.createdAt)];
    case "status":
      return [direction(releases.status), desc(releases.createdAt)];
    case "releasedAt":
      return [direction(releases.releasedAt), desc(releases.createdAt)];
    case "createdAt":
    default:
      return [desc(releases.createdAt)];
  }
}

// GET /releases - list with pagination and filters
export const listReleases = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      appId: z.string().optional(),
      channel: z.string().optional(),
      status: z.enum(["active", "superseded", "draft", "withdrawn"]).optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, appId, channel, status, sortBy, sortDir } = data;
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
      .orderBy(...releaseOrderBy(sortBy, sortDir))
      .limit(limit)
      .offset(offset);
    const appMap = await loadAppsByIds(
      db,
      items.map((item) => item.appId),
    );
    const latestRows =
      items.length > 0
        ? await db
            .select()
            .from(appLatestReleases)
            .where(
              inArray(
                appLatestReleases.releaseId,
                items.map((item) => item.id),
              ),
            )
            .all()
        : [];
    const latestReleaseIds = new Set(latestRows.map((row) => row.releaseId));
    const pinnedReleaseIds = new Set(
      latestRows.filter((row) => row.pinnedReleaseId).map((row) => row.pinnedReleaseId as string),
    );

    return {
      items: items.map((item) =>
        Object.assign({}, item, {
          app: appMap.get(item.appId) ? toAppSummary(appMap.get(item.appId)!) : null,
          isLatestForChannel: latestReleaseIds.has(item.id),
          isPinnedLatest: pinnedReleaseIds.has(item.id),
        }),
      ),
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  });

// GET /releases/:id - detail
export const getRelease = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const release = await db.select().from(releases).where(eq(releases.id, id)).get();
    if (!release) throw new Error("Not found");
    const appMap = await loadAppsByIds(db, [release.appId]);
    const latestRow = await db
      .select()
      .from(appLatestReleases)
      .where(eq(appLatestReleases.releaseId, release.id))
      .get();
    const isPinnedLatest = latestRow?.pinnedReleaseId === release.id;

    return {
      ...release,
      app: appMap.get(release.appId) ? toAppSummary(appMap.get(release.appId)!) : null,
      isLatestForChannel: Boolean(latestRow),
      isPinnedLatest,
    };
  });

// POST /releases - create manual release
export const createRelease = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(releaseCreateSchema)
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const id = generateId(idPrefixes.release);

    const versionNormalized = normalizeVersion(data.versionRaw);
    const channel = data.channel || inferChannel(data.versionRaw);

    await db.batch([
      db.insert(releases).values({
        id,
        appId: data.appId,
        versionRaw: data.versionRaw,
        versionNormalized,
        buildNumber: data.buildNumber ?? null,
        channel,
        releasedAt: data.releasedAt ?? now,
        isPrerelease: isPreRelease(data.versionRaw),
        status: "active",
        releaseNotesHtml: data.releaseNotesHtml ? sanitizeHtml(data.releaseNotesHtml) : null,
        releaseNotesUrl: data.releaseNotesUrl ?? null,
        createdAt: now,
        updatedAt: now,
      }),
      db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        eventType: "release_created",
        actorType: "admin",
        actorId: context.user.email,
        targetType: "release",
        targetId: id,
        payloadJson: JSON.stringify({ appId: data.appId, versionRaw: data.versionRaw, channel }),
        createdAt: now,
      }),
    ]);

    await scheduleRecomputeLatest({ db, appId: data.appId, channel });

    return { id, status: "created" };
  });

// PATCH /releases/:id - update status/channel/notes
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
    if (fields.releaseNotesHtml !== undefined)
      updates.releaseNotesHtml = fields.releaseNotesHtml
        ? sanitizeHtml(fields.releaseNotesHtml)
        : null;
    if (fields.releaseNotesUrl !== undefined) updates.releaseNotesUrl = fields.releaseNotesUrl;

    await db.batch([
      db.update(releases).set(updates).where(eq(releases.id, id)),
      db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        eventType: "release_updated",
        actorType: "admin",
        actorId: context.user.email,
        targetType: "release",
        targetId: id,
        payloadJson: JSON.stringify(fields),
        createdAt: now,
      }),
    ]);

    const recomputeChannels = new Set<string>();
    if (fields.status !== undefined || fields.channel !== undefined) {
      recomputeChannels.add(existing.channel);
      recomputeChannels.add(fields.channel ?? existing.channel);
    }
    for (const channel of recomputeChannels) {
      await scheduleRecomputeLatest({ db, appId: existing.appId, channel });
    }

    return { status: "updated" };
  });

// GET /releases/:id/artifacts
export const getReleaseArtifacts = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ releaseId: z.string().min(1) }))
  .handler(async ({ data: { releaseId } }) => {
    const db = createDb(env.DB);
    const items = await db.select().from(artifacts).where(eq(artifacts.releaseId, releaseId)).all();
    return { items };
  });

// POST /releases/:id/pin - pin release as latest
export const pinRelease = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id }, context }) => {
    const db = createDb(env.DB);
    const release = await db.select().from(releases).where(eq(releases.id, id)).get();
    if (!release) throw new Error("Not found");

    const now = new Date().toISOString();

    // Update the latest release row to pin this release
    await db
      .update(appLatestReleases)
      .set({
        pinnedReleaseId: id,
        pinnedAt: now,
        pinnedBy: context.user.email,
        updatedAt: now,
      })
      .where(
        and(
          eq(appLatestReleases.appId, release.appId),
          eq(appLatestReleases.channel, release.channel),
        ),
      );

    await scheduleRecomputeLatest({ db, appId: release.appId, channel: release.channel });

    return { status: "pinned" };
  });

// POST /releases/:id/unpin - remove pin
export const unpinRelease = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const release = await db.select().from(releases).where(eq(releases.id, id)).get();
    if (!release) throw new Error("Not found");

    await db
      .update(appLatestReleases)
      .set({
        pinnedReleaseId: null,
        pinnedAt: null,
        pinnedBy: null,
        updatedAt: new Date().toISOString(),
      })
      .where(
        and(
          eq(appLatestReleases.appId, release.appId),
          eq(appLatestReleases.channel, release.channel),
        ),
      );

    await scheduleRecomputeLatest({ db, appId: release.appId, channel: release.channel });

    return { status: "unpinned" };
  });

// GET /releases/:id/observations
export const getReleaseObservations = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
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
