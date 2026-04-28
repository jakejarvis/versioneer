import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";

import { computeNextPollAt, initialNextPollAt } from "@versioneer/core/pipeline";
import { getDescriptor, normalizeBaseUrl } from "@versioneer/core/sources";
import { sourceCreateSchema, sourceUpdateSchema } from "@versioneer/core/validation";
import { createDb } from "@versioneer/db";
import {
  apps,
  sources,
  sourceFetches,
  parserRuns,
  auditLog,
  catalogSuggestions,
  generateId,
  idPrefixes,
} from "@versioneer/db";
import {
  defaultRoleForSourceType,
  defaultRuntimeStatusForSourceType,
  sourceTypeSchema,
} from "@versioneer/schemas/sources";

import { AliasConflictError, assertNoConflictingExactAlias } from "./alias-conflicts";
import { captureAdminEvent } from "./analytics";
import { invalidateInventoryMatchSnapshot } from "./cache";
import type { Db } from "./db-types";
import { loadAppsByIds, toAppSummary } from "./entity-summaries";
import { atRiskSourceCondition } from "./homepage-helpers";
import { authMiddleware } from "./middleware";
import { sourceFetchOrderBy, sourceOrderBy } from "./order-by";
import { scheduleSourceFetch, scheduleSourceReparse } from "./pipeline-jobs";
import { prepareSyncSourceDerivedAliasWrites } from "./source-derived-aliases";
import { computeReorderedSourceRoles, validateSourceReorderInput } from "./source-reorder";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

async function prepareAuthorityHandoffInsert(params: {
  db: Db;
  appId: string;
  channel: string | null;
  fromSourceId: string;
  toSourceId: string;
  now: string;
}) {
  const dedupeKey = `authority_handoff:${params.appId}:${params.channel ?? "stable"}:${params.fromSourceId}:${params.toSourceId}`;
  const existing = await params.db
    .select({ id: catalogSuggestions.id })
    .from(catalogSuggestions)
    .where(eq(catalogSuggestions.dedupeKey, dedupeKey))
    .get();
  if (existing) return null;

  return params.db.insert(catalogSuggestions).values({
    id: generateId(idPrefixes.catalogSuggestion),
    queueType: "authority_handoff",
    status: "pending",
    appId: params.appId,
    sourceId: params.toSourceId,
    bundleKey: null,
    dedupeKey,
    title: `Review authority handoff for ${params.channel ?? "stable"} channel`,
    canonicalSnapshotJson: null,
    proposedChangeJson: JSON.stringify({
      appId: params.appId,
      channel: params.channel,
      fromSourceId: params.fromSourceId,
      toSourceId: params.toSourceId,
    }),
    evidenceSummaryJson: JSON.stringify({
      conflictingAuthorityId: params.fromSourceId,
      newSourceId: params.toSourceId,
    }),
    evidenceCount: 0,
    firstSeenAt: params.now,
    lastSeenAt: params.now,
    createdAt: params.now,
    updatedAt: params.now,
  });
}

// GET /sources - list with pagination and filters
export const listSources = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["active", "paused", "disabled", "error", "at_risk"]).optional(),
      sourceType: sourceTypeSchema.optional(),
      appId: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, status, sourceType, appId, sortBy, sortDir } = data;
    const db = createDb(env.DB);

    const conditions = [];
    if (status === "at_risk") {
      conditions.push(atRiskSourceCondition);
    } else if (status) {
      conditions.push(eq(sources.status, status));
    }
    if (sourceType) conditions.push(eq(sources.sourceType, sourceType));
    if (appId) conditions.push(eq(sources.appId, appId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;
    const orderBy =
      status === "at_risk" && !sortBy
        ? [
            sql`case when ${sources.status} = 'error' then 0 else 1 end`,
            desc(sources.lastFailureAt),
            asc(sources.lastFetchedAt),
            desc(sources.updatedAt),
          ]
        : sourceOrderBy(sortBy, sortDir);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(sources)
      .where(where);
    const items = await db
      .select()
      .from(sources)
      .where(where)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);
    const appMap = await loadAppsByIds(
      db,
      items.map((item) => item.appId),
    );

    return {
      items: items.map((item) =>
        Object.assign({}, item, {
          app: appMap.get(item.appId) ? toAppSummary(appMap.get(item.appId)!) : null,
        }),
      ),
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  });

// GET /sources/:id - detail
export const getSource = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const source = await db.select().from(sources).where(eq(sources.id, id)).get();
    if (!source) throw new Error("Not found");
    const appMap = await loadAppsByIds(db, [source.appId]);

    return {
      ...source,
      app: appMap.get(source.appId) ? toAppSummary(appMap.get(source.appId)!) : null,
    };
  });

// POST /sources - create
export const createSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(sourceCreateSchema)
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const id = generateId(idPrefixes.source);
    const normalizedBaseUrl = data.baseUrl ? normalizeBaseUrl(data.sourceType, data.baseUrl) : null;
    const desiredRole =
      data.reviewStatus === "approved"
        ? (data.role ?? defaultRoleForSourceType(data.sourceType))
        : (data.role ?? null);
    const conflictingAuthority =
      data.reviewStatus === "approved" && desiredRole === "authority"
        ? await db
            .select({ id: sources.id })
            .from(sources)
            .where(
              and(
                eq(sources.appId, data.appId),
                eq(sources.reviewStatus, "approved"),
                eq(sources.role, "authority"),
                data.channel ? eq(sources.channel, data.channel) : sql`${sources.channel} is null`,
              ),
            )
            .get()
        : null;
    const persistedRole = conflictingAuthority ? "corroborating" : desiredRole;
    const runtimeStatus =
      data.reviewStatus === "approved"
        ? defaultRuntimeStatusForSourceType(data.sourceType)
        : "disabled";

    const derivedAlias = normalizedBaseUrl
      ? getDescriptor(data.sourceType).derivedAlias(normalizedBaseUrl)
      : null;
    if (data.reviewStatus === "approved" && derivedAlias) {
      try {
        await assertNoConflictingExactAlias(db, {
          aliasType: derivedAlias.aliasType,
          value: derivedAlias.value,
          appId: data.appId,
        });
      } catch (error) {
        if (error instanceof AliasConflictError) {
          throw new Error(
            `Conflicting ${derivedAlias.aliasType} already belongs to app ${error.appId}`,
            { cause: error },
          );
        }
        throw error;
      }
    }

    // Assign next ordinal for this app
    const [maxOrdinalResult] = await db
      .select({ maxOrd: sql<number>`coalesce(max(${sources.ordinal}), -1)` })
      .from(sources)
      .where(eq(sources.appId, data.appId));
    const nextOrdinal = (maxOrdinalResult?.maxOrd ?? -1) + 1;

    const shouldQueueFetch = data.reviewStatus === "approved" && runtimeStatus === "active";

    // Pre-batch reads
    const derivedAliasWrites =
      data.reviewStatus === "approved"
        ? await prepareSyncSourceDerivedAliasWrites(db, {
            appId: data.appId,
            sourceId: id,
            sourceType: data.sourceType,
            baseUrl: normalizedBaseUrl,
            now,
          })
        : [];

    let handoffInsert: Awaited<ReturnType<typeof prepareAuthorityHandoffInsert>> = null;
    if (conflictingAuthority) {
      const appRow = await db
        .select({ status: apps.status })
        .from(apps)
        .where(eq(apps.id, data.appId))
        .get();
      if (appRow?.status === "public") {
        handoffInsert = await prepareAuthorityHandoffInsert({
          db,
          appId: data.appId,
          channel: data.channel ?? null,
          fromSourceId: conflictingAuthority.id,
          toSourceId: id,
          now,
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writes: any[] = [
      db.insert(sources).values({
        id,
        appId: data.appId,
        sourceType: data.sourceType,
        label: data.label ?? null,
        baseUrl: normalizedBaseUrl,
        configJson: data.configJson ?? null,
        parserKey: data.parserKey,
        channel: data.channel ?? null,
        pollIntervalMinutes: data.pollIntervalMinutes,
        reviewStatus: data.reviewStatus,
        role: persistedRole,
        ordinal: nextOrdinal,
        status: runtimeStatus,
        nextPollAt: initialNextPollAt({
          status: runtimeStatus,
          pollIntervalMinutes: data.pollIntervalMinutes,
          now,
        }),
        approvedAt: data.reviewStatus === "approved" ? now : null,
        reviewedAt: data.reviewStatus === "approved" ? now : null,
        reviewedBy: data.reviewStatus === "approved" ? context.user.email : null,
        createdAt: now,
        updatedAt: now,
      }),
      ...derivedAliasWrites,
      ...(handoffInsert ? [handoffInsert] : []),
      db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        eventType: "source_created",
        actorType: "admin",
        actorId: context.user.email,
        targetType: "source",
        targetId: id,
        payloadJson: JSON.stringify(data),
        createdAt: now,
      }),
    ];
    await db.batch(writes as [(typeof writes)[0], ...typeof writes]);
    await invalidateInventoryMatchSnapshot(env);

    if (shouldQueueFetch) {
      await scheduleSourceFetch({ db, sourceId: id, reason: "source-create", force: true });
    }
    await captureAdminEvent(context.user, "source_created", {
      target_type: "source",
      target_id: id,
      app_id: data.appId,
      source_type: data.sourceType,
      status: runtimeStatus,
    });

    return { id, status: "created" };
  });

// PATCH /sources/:id - update
export const updateSource = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(sourceUpdateSchema.extend({ id: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const { id, ...fields } = data;
    const db = createDb(env.DB);

    const existing = await db.select().from(sources).where(eq(sources.id, id)).get();
    if (!existing) throw new Error("Not found");

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: now };
    const nextBaseUrl =
      fields.baseUrl !== undefined
        ? fields.baseUrl
          ? normalizeBaseUrl(existing.sourceType, fields.baseUrl)
          : null
        : existing.baseUrl;
    const nextReviewStatus = fields.reviewStatus ?? existing.reviewStatus;
    const transitionedToApproved =
      nextReviewStatus === "approved" && existing.reviewStatus !== "approved";
    const desiredRole =
      nextReviewStatus === "approved"
        ? ((fields.role !== undefined
            ? fields.role
            : transitionedToApproved
              ? null
              : existing.role) ?? defaultRoleForSourceType(existing.sourceType))
        : fields.role !== undefined
          ? fields.role
          : existing.role;
    const nextChannel = fields.channel !== undefined ? fields.channel : existing.channel;
    const conflictingAuthority =
      nextReviewStatus === "approved" && desiredRole === "authority"
        ? await db
            .select({ id: sources.id })
            .from(sources)
            .where(
              and(
                eq(sources.appId, existing.appId),
                ne(sources.id, existing.id),
                eq(sources.reviewStatus, "approved"),
                eq(sources.role, "authority"),
                nextChannel ? eq(sources.channel, nextChannel) : sql`${sources.channel} is null`,
              ),
            )
            .get()
        : null;
    const persistedRole = conflictingAuthority ? "corroborating" : desiredRole;
    const nextStatus =
      nextReviewStatus === "approved"
        ? (fields.status ??
          (transitionedToApproved
            ? defaultRuntimeStatusForSourceType(existing.sourceType)
            : existing.status))
        : (fields.status ?? (fields.reviewStatus !== undefined ? "disabled" : existing.status));

    const derivedAlias = nextBaseUrl
      ? getDescriptor(existing.sourceType).derivedAlias(nextBaseUrl)
      : null;
    if (nextReviewStatus === "approved" && derivedAlias) {
      try {
        await assertNoConflictingExactAlias(db, {
          aliasType: derivedAlias.aliasType,
          value: derivedAlias.value,
          appId: existing.appId,
        });
      } catch (error) {
        if (error instanceof AliasConflictError) {
          throw new Error(
            `Conflicting ${derivedAlias.aliasType} already belongs to app ${error.appId}`,
            { cause: error },
          );
        }
        throw error;
      }
    }

    if (fields.label !== undefined) updates.label = fields.label;
    if (fields.baseUrl !== undefined) updates.baseUrl = nextBaseUrl;
    if (fields.configJson !== undefined) updates.configJson = fields.configJson;
    if (fields.parserKey !== undefined) updates.parserKey = fields.parserKey;
    if (fields.pollIntervalMinutes !== undefined)
      updates.pollIntervalMinutes = fields.pollIntervalMinutes;
    if (fields.channel !== undefined) updates.channel = fields.channel;
    if (fields.reviewStatus !== undefined) updates.reviewStatus = nextReviewStatus;
    if (fields.role !== undefined || conflictingAuthority || transitionedToApproved) {
      updates.role = persistedRole;
    }
    if (fields.status !== undefined || fields.reviewStatus !== undefined) {
      updates.status = nextStatus;
    }
    const shouldQueueFetch =
      nextReviewStatus === "approved" &&
      nextStatus === "active" &&
      (transitionedToApproved ||
        nextBaseUrl !== existing.baseUrl ||
        fields.configJson !== undefined ||
        fields.parserKey !== undefined ||
        (fields.status === "active" && existing.status !== "active"));
    if (
      shouldQueueFetch ||
      fields.pollIntervalMinutes !== undefined ||
      fields.status !== undefined ||
      fields.reviewStatus !== undefined
    ) {
      updates.nextPollAt =
        nextStatus === "active"
          ? shouldQueueFetch
            ? initialNextPollAt({
                status: nextStatus,
                pollIntervalMinutes: fields.pollIntervalMinutes ?? existing.pollIntervalMinutes,
                now,
              })
            : computeNextPollAt({
                baseTime: existing.lastFetchedAt ?? now,
                pollIntervalMinutes: fields.pollIntervalMinutes ?? existing.pollIntervalMinutes,
                now,
              })
          : null;
    }
    if (fields.reviewStatus !== undefined) {
      updates.reviewedAt = now;
      updates.reviewedBy = context.user.email;
      if (nextReviewStatus === "approved" && !existing.approvedAt) {
        updates.approvedAt = now;
      }
    }

    // Pre-batch reads
    const derivedAliasWrites = await prepareSyncSourceDerivedAliasWrites(db, {
      appId: existing.appId,
      sourceId: existing.id,
      sourceType: existing.sourceType,
      baseUrl: nextReviewStatus === "approved" ? nextBaseUrl : null,
      now,
    });

    let handoffInsert: Awaited<ReturnType<typeof prepareAuthorityHandoffInsert>> = null;
    if (conflictingAuthority) {
      const appRow = await db
        .select({ status: apps.status })
        .from(apps)
        .where(eq(apps.id, existing.appId))
        .get();
      if (appRow?.status === "public") {
        handoffInsert = await prepareAuthorityHandoffInsert({
          db,
          appId: existing.appId,
          channel: nextChannel ?? null,
          fromSourceId: conflictingAuthority.id,
          toSourceId: existing.id,
          now,
        });
      }
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writes: any[] = [
      db.update(sources).set(updates).where(eq(sources.id, id)),
      ...derivedAliasWrites,
      ...(handoffInsert ? [handoffInsert] : []),
      db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        eventType: "source_updated",
        actorType: "admin",
        actorId: context.user.email,
        targetType: "source",
        targetId: id,
        payloadJson: JSON.stringify(fields),
        createdAt: now,
      }),
    ];
    await db.batch(writes as [(typeof writes)[0], ...typeof writes]);
    await invalidateInventoryMatchSnapshot(env);

    if (shouldQueueFetch) {
      await scheduleSourceFetch({
        db,
        sourceId: existing.id,
        reason: "source-update",
        force: true,
      });
    }
    await captureAdminEvent(context.user, "source_updated", {
      target_type: "source",
      target_id: id,
      app_id: existing.appId,
      source_type: existing.sourceType,
      status: nextStatus,
    });

    return { status: "updated" };
  });

// POST /sources/:id/fetch - trigger fetch
export const triggerFetch = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      sourceId: z.string().min(1),
      reason: z.string().default("manual"),
      force: z.boolean().default(false),
    }),
  )
  .handler(async ({ data: { sourceId, reason, force }, context }) => {
    const db = createDb(env.DB);
    const source = await db.select().from(sources).where(eq(sources.id, sourceId)).get();
    if (!source) throw new Error("Not found");

    const result = await scheduleSourceFetch({ db, sourceId, reason, force });
    await captureAdminEvent(context.user, "manual_job_triggered", {
      target_type: "source",
      target_id: sourceId,
      job_type: "source-fetch",
      reason,
      status: result.ok ? "queued" : "failed",
    });
    return {
      status: result.ok ? "queued" : "failed",
      sourceId,
      errorMessage: result.errorMessage ?? null,
    };
  });

// GET /sources/:id/fetches - paginated fetch history
export const getSourceFetches = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      sourceId: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { sourceId, limit, offset, sortBy, sortDir } = data;
    const db = createDb(env.DB);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(sourceFetches)
      .where(eq(sourceFetches.sourceId, sourceId));
    const items = await db
      .select()
      .from(sourceFetches)
      .where(eq(sourceFetches.sourceId, sourceId))
      .orderBy(...sourceFetchOrderBy(sortBy, sortDir))
      .limit(limit)
      .offset(offset);

    return { items, total: countResult?.count ?? 0, limit, offset };
  });

// GET /source-fetches/:id - single fetch detail
export const getSourceFetch = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const fetchRecord = await db.select().from(sourceFetches).where(eq(sourceFetches.id, id)).get();
    if (!fetchRecord) throw new Error("Not found");
    return fetchRecord;
  });

// POST /source-fetches/:id/reparse - send to parse queue
export const reparse = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ sourceFetchId: z.string().min(1) }))
  .handler(async ({ data: { sourceFetchId }, context }) => {
    const result = await scheduleSourceReparse({
      db: createDb(env.DB),
      sourceFetchId,
    });
    await captureAdminEvent(context.user, "manual_job_triggered", {
      target_type: "source_fetch",
      target_id: sourceFetchId,
      job_type: "source-parse",
      status: result.ok ? "queued" : "failed",
    });
    return {
      status: result.ok ? "queued" : "failed",
      sourceFetchId,
      errorMessage: result.errorMessage ?? null,
    };
  });

// POST /sources/reorder - reorder sources for an app
export const reorderSources = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      appId: z.string().min(1),
      sourceIds: z.array(z.string().min(1)).min(1),
    }),
  )
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();

    // Verify all source IDs belong to the app
    const appSources = await db
      .select({
        id: sources.id,
        role: sources.role,
        sourceType: sources.sourceType,
        channel: sources.channel,
      })
      .from(sources)
      .where(eq(sources.appId, data.appId))
      .all();
    const reorderValidationError = validateSourceReorderInput({
      appSourceIds: appSources.map((source) => source.id),
      requestedSourceIds: data.sourceIds,
    });
    if (reorderValidationError) throw new Error(reorderValidationError);

    const reorderedRoles = computeReorderedSourceRoles({
      sources: appSources,
      requestedSourceIds: data.sourceIds,
    });

    // Keep ordinal/role reassignment atomic so a failed write cannot leave two authorities.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- collected for db.batch()
    const writes: any[] = [];
    for (let i = 0; i < data.sourceIds.length; i++) {
      const sourceId = data.sourceIds[i]!;
      const role = reorderedRoles.get(sourceId);
      if (!role) continue;

      writes.push(
        db
          .update(sources)
          .set({ ordinal: i, role, updatedAt: now })
          .where(eq(sources.id, sourceId)),
      );
    }

    writes.push(
      db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        eventType: "sources_reordered",
        actorType: "admin",
        actorId: context.user.email,
        targetType: "app",
        targetId: data.appId,
        payloadJson: JSON.stringify({ sourceIds: data.sourceIds }),
        createdAt: now,
      }),
    );

    await db.batch(writes as [(typeof writes)[0], ...typeof writes]);

    await captureAdminEvent(context.user, "sources_reordered", {
      target_type: "app",
      target_id: data.appId,
      count: data.sourceIds.length,
      status: "reordered",
    });

    return { status: "reordered" };
  });

// GET /source-fetches/:id/parser-runs
export const getParserRuns = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ fetchId: z.string().min(1) }))
  .handler(async ({ data: { fetchId } }) => {
    const db = createDb(env.DB);
    const items = await db
      .select()
      .from(parserRuns)
      .where(eq(parserRuns.sourceFetchId, fetchId))
      .orderBy(desc(parserRuns.startedAt))
      .all();
    return { items };
  });
