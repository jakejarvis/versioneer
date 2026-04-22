import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

import { normalizeReleaseNotes } from "@versioneer/core/pipeline";
import { releaseCreateSchema, releaseUpdateSchema } from "@versioneer/core/validation";
import { normalizeVersion, isPreRelease, inferChannel } from "@versioneer/core/versioning";
import { createDb } from "@versioneer/db";
import {
  appAliases,
  releases,
  artifacts,
  releaseObservations,
  appLatestReleases,
  trustAssertions,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/db";
import {
  artifactArchitectureSchema,
  targetArchitectureSchema,
} from "@versioneer/schemas/architecture";
import { artifactTypeSchema } from "@versioneer/schemas/releases";

import { captureAdminEvent } from "./analytics";
import { loadAppsByIds, toAppSummary } from "./entity-summaries";
import { scheduleRecomputeLatest } from "./followup-jobs";
import { latestReleaseTrustWarnings } from "./install-trust";
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
    const latestTargetsByRelease = new Map<string, string[]>();
    const pinnedTargetsByRelease = new Map<string, string[]>();
    for (const row of latestRows) {
      latestTargetsByRelease.set(row.releaseId, [
        ...(latestTargetsByRelease.get(row.releaseId) ?? []),
        row.targetArchitecture,
      ]);
      if (row.pinnedReleaseId) {
        pinnedTargetsByRelease.set(row.pinnedReleaseId, [
          ...(pinnedTargetsByRelease.get(row.pinnedReleaseId) ?? []),
          row.targetArchitecture,
        ]);
      }
    }

    return {
      items: items.map((item) =>
        Object.assign({}, item, {
          app: appMap.get(item.appId) ? toAppSummary(appMap.get(item.appId)!) : null,
          isLatestForChannel: latestTargetsByRelease.has(item.id),
          isPinnedLatest: pinnedTargetsByRelease.has(item.id),
          latestTargetArchitectures: latestTargetsByRelease.get(item.id) ?? [],
          pinnedTargetArchitectures: pinnedTargetsByRelease.get(item.id) ?? [],
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
    const latestRows = await db
      .select()
      .from(appLatestReleases)
      .where(eq(appLatestReleases.releaseId, release.id))
      .all();
    const isPinnedLatest = latestRows.some((row) => row.pinnedReleaseId === release.id);
    const latestArtifactIds = latestRows
      .map((row) => row.artifactId)
      .filter((artifactId): artifactId is string => Boolean(artifactId));
    const latestArtifactRows =
      latestArtifactIds.length > 0
        ? await db
            .select({
              id: artifacts.id,
              sha256: artifacts.sha256,
              architecture: artifacts.architecture,
            })
            .from(artifacts)
            .where(inArray(artifacts.id, latestArtifactIds))
            .all()
        : [];
    const artifactById = new Map(latestArtifactRows.map((artifact) => [artifact.id, artifact]));
    const trustRows = await db
      .select({ assertionType: trustAssertions.assertionType })
      .from(trustAssertions)
      .where(eq(trustAssertions.appId, release.appId))
      .all();
    const aliasRows = await db
      .select({ aliasType: appAliases.aliasType })
      .from(appAliases)
      .where(and(eq(appAliases.appId, release.appId), eq(appAliases.isActive, true)))
      .all();

    const latestTargets = latestRows.map((row) => {
      const trustWarnings = latestReleaseTrustWarnings({
        installStrategy: row.installStrategy,
        artifact: row.artifactId ? artifactById.get(row.artifactId) : undefined,
        targetArchitecture: row.targetArchitecture,
        trustTypes: new Set(trustRows.map((trustRow) => trustRow.assertionType)),
        aliasTypes: new Set(aliasRows.map((aliasRow) => aliasRow.aliasType)),
      });

      return {
        id: row.id,
        targetArchitecture: row.targetArchitecture,
        channel: row.channel,
        artifactId: row.artifactId,
        installStrategy: row.installStrategy,
        pinnedReleaseId: row.pinnedReleaseId,
        pinnedAt: row.pinnedAt,
        pinnedBy: row.pinnedBy,
        trustWarnings,
      };
    });

    return {
      ...release,
      app: appMap.get(release.appId) ? toAppSummary(appMap.get(release.appId)!) : null,
      isLatestForChannel: latestRows.length > 0,
      isPinnedLatest,
      latestInstallStrategy: latestRows[0]?.installStrategy ?? null,
      latestArtifactId: latestRows[0]?.artifactId ?? null,
      latestTargets,
      trustWarnings: latestTargets.flatMap((target) => target.trustWarnings),
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
        releaseNotesMarkdown: data.releaseNotesMarkdown
          ? await normalizeReleaseNotes(data.releaseNotesMarkdown, "markdown")
          : null,
        releaseNotesHtml: null,
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
    await captureAdminEvent(context.user, "release_created", {
      target_type: "release",
      target_id: id,
      app_id: data.appId,
      channel,
      status: "created",
    });

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
    if (fields.releaseNotesMarkdown !== undefined) {
      updates.releaseNotesMarkdown = fields.releaseNotesMarkdown
        ? await normalizeReleaseNotes(fields.releaseNotesMarkdown, "markdown")
        : null;
      updates.releaseNotesHtml = null;
    }
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
    await captureAdminEvent(context.user, "release_updated", {
      target_type: "release",
      target_id: id,
      app_id: existing.appId,
      channel: fields.channel ?? existing.channel,
      status: fields.status ?? existing.status,
    });

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

export const createReleaseArtifact = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      releaseId: z.string().min(1),
      artifactType: artifactTypeSchema,
      url: z.string().url(),
      architecture: artifactArchitectureSchema,
      sha256: z.string().max(256).nullable().optional(),
      sizeBytes: z.number().int().positive().nullable().optional(),
      minOsVersion: z.string().max(50).nullable().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const release = await db.select().from(releases).where(eq(releases.id, data.releaseId)).get();
    if (!release) throw new Error("Not found");

    const now = new Date().toISOString();
    const artifactId = generateId(idPrefixes.artifact);
    await db.batch([
      db.insert(artifacts).values({
        id: artifactId,
        releaseId: release.id,
        artifactType: data.artifactType,
        url: data.url,
        urlHash: null,
        sha256: data.sha256?.trim() || null,
        sizeBytes: data.sizeBytes ?? null,
        architecture: data.architecture,
        minOsVersion: data.minOsVersion?.trim() || null,
        isPrimary: false,
        createdAt: now,
      }),
      db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        eventType: "release_artifact_created",
        actorType: "admin",
        actorId: context.user.email,
        targetType: "artifact",
        targetId: artifactId,
        payloadJson: JSON.stringify({
          releaseId: release.id,
          artifactType: data.artifactType,
          architecture: data.architecture,
          url: data.url,
        }),
        createdAt: now,
      }),
    ]);

    await scheduleRecomputeLatest({ db, appId: release.appId, channel: release.channel });
    await captureAdminEvent(context.user, "release_artifact_created", {
      target_type: "artifact",
      target_id: artifactId,
      release_id: release.id,
      app_id: release.appId,
      artifact_type: data.artifactType,
      architecture: data.architecture,
      status: "created",
    });
    return { id: artifactId, status: "created" };
  });

// POST /releases/:id/pin - pin release as latest
export const pinRelease = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1), targetArchitecture: targetArchitectureSchema }))
  .handler(async ({ data: { id, targetArchitecture }, context }) => {
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
          eq(appLatestReleases.targetArchitecture, targetArchitecture),
        ),
      );

    await scheduleRecomputeLatest({ db, appId: release.appId, channel: release.channel });
    await captureAdminEvent(context.user, "release_pinned", {
      target_type: "release",
      target_id: id,
      app_id: release.appId,
      target_architecture: targetArchitecture,
      status: "pinned",
    });

    return { status: "pinned" };
  });

// POST /releases/:id/unpin - remove pin
export const unpinRelease = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1), targetArchitecture: targetArchitectureSchema }))
  .handler(async ({ data: { id, targetArchitecture }, context }) => {
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
          eq(appLatestReleases.targetArchitecture, targetArchitecture),
        ),
      );

    await scheduleRecomputeLatest({ db, appId: release.appId, channel: release.channel });
    await captureAdminEvent(context.user, "release_unpinned", {
      target_type: "release",
      target_id: id,
      app_id: release.appId,
      target_architecture: targetArchitecture,
      status: "unpinned",
    });

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
