import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, inArray, like, sql } from "drizzle-orm";
import { z } from "zod";

import { pipelineWorker } from "@/lib/pipeline";
import { normalizeAliasValue } from "@versioneer/core/identity";
import { appCreateSchema, appUpdateSchema, aliasCreateSchema } from "@versioneer/core/validation";
import { createDb } from "@versioneer/db";
import {
  apps,
  appAliases,
  appLatestReleases,
  artifacts,
  sources,
  releases,
  trustAssertions,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/db";

import { AliasConflictError, assertNoConflictingExactAlias } from "./alias-conflicts";
import { buildAppSourceHealth } from "./homepage-helpers";
import { latestReleaseTrustWarnings } from "./install-trust";
import { buildAppSortDescriptors } from "./list-helpers";
import { authMiddleware } from "./middleware";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function appOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const sortColumns = {
    canonicalName: apps.canonicalName,
    slug: apps.slug,
    vendorName: apps.vendorName,
    status: apps.status,
    updatedAt: apps.updatedAt,
  };

  return buildAppSortDescriptors(sortBy, sortDir).map((descriptor) =>
    (descriptor.dir === "asc" ? asc : desc)(
      sortColumns[descriptor.field as keyof typeof sortColumns],
    ),
  );
}

function appReleaseOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
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

// GET /apps - list with pagination, status/search filters
export const listApps = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["draft", "public", "deprecated", "merged", "unlisted"]).optional(),
      search: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const { limit, offset, status, search, sortBy, sortDir } = data;

    const conditions = [];
    if (status) conditions.push(eq(apps.status, status));
    if (search) conditions.push(like(apps.canonicalName, `%${search}%`));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(apps)
      .where(where);
    const items = await db
      .select()
      .from(apps)
      .where(where)
      .orderBy(...appOrderBy(sortBy, sortDir))
      .limit(limit)
      .offset(offset);

    const countRows =
      items.length > 0
        ? await db
            .select({
              appId: sources.appId,
              count: sql<number>`count(*)`,
            })
            .from(sources)
            .where(
              inArray(
                sources.appId,
                items.map((item) => item.id),
              ),
            )
            .groupBy(sources.appId)
            .all()
        : [];
    const sourceCounts = new Map(countRows.map((row) => [row.appId, row.count]));

    return {
      items: items.map((item) =>
        Object.assign({}, item, { sourceCount: sourceCounts.get(item.id) ?? 0 }),
      ),
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  });

// GET /apps/:id - detail with latestReleases, sourceCount
export const getApp = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);

    const app = await db.select().from(apps).where(eq(apps.id, id)).get();
    if (!app) throw new Error("Not found");

    const latestRows = await db
      .select()
      .from(appLatestReleases)
      .where(eq(appLatestReleases.appId, id))
      .all();
    const latestArtifactIds = latestRows
      .map((row) => row.artifactId)
      .filter((artifactId): artifactId is string => Boolean(artifactId));
    const latestArtifacts =
      latestArtifactIds.length > 0
        ? await db
            .select({ id: artifacts.id, sha256: artifacts.sha256 })
            .from(artifacts)
            .where(inArray(artifacts.id, latestArtifactIds))
            .all()
        : [];
    const artifactById = new Map(latestArtifacts.map((artifact) => [artifact.id, artifact]));
    const trustRows = await db
      .select({ assertionType: trustAssertions.assertionType })
      .from(trustAssertions)
      .where(eq(trustAssertions.appId, id))
      .all();
    const trustTypes = new Set(trustRows.map((row) => row.assertionType));
    const aliasRows = await db
      .select({ aliasType: appAliases.aliasType })
      .from(appAliases)
      .where(and(eq(appAliases.appId, id), eq(appAliases.isActive, true)))
      .all();
    const aliasTypes = new Set(aliasRows.map((row) => row.aliasType));
    const latest = latestRows.map((row) =>
      Object.assign({}, row, {
        trustWarnings: latestReleaseTrustWarnings({
          installStrategy: row.installStrategy,
          artifact: row.artifactId ? artifactById.get(row.artifactId) : undefined,
          trustTypes,
          aliasTypes,
        }),
      }),
    );
    const [sourceCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(sources)
      .where(eq(sources.appId, id));
    const sourceRows = await db.select().from(sources).where(eq(sources.appId, id)).all();

    return {
      ...app,
      latestReleases: latest,
      sourceCount: sourceCount?.count ?? 0,
      sourceHealth: buildAppSourceHealth(sourceRows),
    };
  });

// POST /apps - create
export const createApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(appCreateSchema)
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const id = generateId(idPrefixes.app);

    await db.insert(apps).values({
      id,
      slug: data.slug,
      canonicalName: data.canonicalName,
      vendorName: data.vendorName ?? null,
      homepageUrl: data.homepageUrl ?? null,
      notes: data.notes ?? null,
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "app_created",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "app",
      targetId: id,
      payloadJson: JSON.stringify(data),
      createdAt: now,
    });

    return { id, status: "created" };
  });

// PATCH /apps/:id - update
export const updateApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(appUpdateSchema.extend({ id: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const { id, ...fields } = data;
    const db = createDb(env.DB);

    const existing = await db.select().from(apps).where(eq(apps.id, id)).get();
    if (!existing) throw new Error("Not found");

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (fields.canonicalName !== undefined) updates.canonicalName = fields.canonicalName;
    if (fields.vendorName !== undefined) updates.vendorName = fields.vendorName;
    if (fields.homepageUrl !== undefined) updates.homepageUrl = fields.homepageUrl;
    if (fields.status !== undefined) updates.status = fields.status;
    if (fields.mergedIntoAppId !== undefined) updates.mergedIntoAppId = fields.mergedIntoAppId;
    if (fields.notes !== undefined) updates.notes = fields.notes;
    if (fields.defaultReleaseNotesUrl !== undefined)
      updates.defaultReleaseNotesUrl = fields.defaultReleaseNotesUrl;
    if (fields.iconR2Key !== undefined) updates.iconR2Key = fields.iconR2Key;

    await db.update(apps).set(updates).where(eq(apps.id, id));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "app_updated",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "app",
      targetId: id,
      payloadJson: JSON.stringify(fields),
      createdAt: now,
    });

    return { status: "updated" };
  });

// GET /apps/:id/aliases
export const getAppAliases = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data: { appId } }) => {
    const db = createDb(env.DB);
    const items = await db.select().from(appAliases).where(eq(appAliases.appId, appId)).all();
    return { items };
  });

// POST /apps/:id/aliases
export const createAlias = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(aliasCreateSchema.extend({ appId: z.string().min(1) }))
  .handler(async ({ data, context }) => {
    const { appId, ...aliasData } = data;
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const id = generateId(idPrefixes.alias);
    const normalizedValue = normalizeAliasValue(aliasData.aliasType, aliasData.value);

    try {
      await assertNoConflictingExactAlias(db, {
        aliasType: aliasData.aliasType,
        value: aliasData.value,
        appId,
        isExact: aliasData.isExact,
      });
    } catch (error) {
      if (error instanceof AliasConflictError) {
        throw new Error(
          `Conflicting ${aliasData.aliasType.replaceAll("_", " ")} already belongs to app ${error.appId}`,
          { cause: error },
        );
      }
      throw error;
    }

    await db.insert(appAliases).values({
      id,
      appId,
      aliasType: aliasData.aliasType,
      value: aliasData.value,
      normalizedValue,
      isExact: aliasData.isExact,
      priority: aliasData.priority,
      confidenceWeight: aliasData.confidenceWeight,
      source: aliasData.source ?? null,
      isActive: true,
      createdAt: now,
    });

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "alias_created",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "alias",
      targetId: id,
      payloadJson: JSON.stringify({ appId, ...aliasData }),
      createdAt: now,
    });

    return { id, status: "created" };
  });

// GET /apps/:id/sources
export const getAppSources = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data: { appId } }) => {
    const db = createDb(env.DB);
    const items = await db
      .select()
      .from(sources)
      .where(eq(sources.appId, appId))
      .orderBy(asc(sources.ordinal))
      .all();
    return { items };
  });

// GET /apps/:id/releases - paginated with filters
export const getAppReleases = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      appId: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      channel: z.string().optional(),
      status: z.enum(["active", "superseded", "draft", "withdrawn"]).optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { appId, limit, offset, channel, status, sortBy, sortDir } = data;
    const db = createDb(env.DB);

    const conditions = [eq(releases.appId, appId)];
    if (channel) conditions.push(eq(releases.channel, channel));
    if (status) conditions.push(eq(releases.status, status));

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(releases)
      .where(and(...conditions));
    const items = await db
      .select()
      .from(releases)
      .where(and(...conditions))
      .orderBy(...appReleaseOrderBy(sortBy, sortDir))
      .limit(limit)
      .offset(offset);

    return { items, total: countResult?.count ?? 0, limit, offset };
  });

// GET /apps/:id/latest
export const getAppLatest = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data: { appId } }) => {
    const db = createDb(env.DB);
    const rows = await db
      .select()
      .from(appLatestReleases)
      .where(eq(appLatestReleases.appId, appId))
      .all();
    const artifactIds = rows
      .map((row) => row.artifactId)
      .filter((artifactId): artifactId is string => Boolean(artifactId));
    const artifactRows =
      artifactIds.length > 0
        ? await db
            .select({ id: artifacts.id, sha256: artifacts.sha256 })
            .from(artifacts)
            .where(inArray(artifacts.id, artifactIds))
            .all()
        : [];
    const artifactById = new Map(artifactRows.map((artifact) => [artifact.id, artifact]));
    const trustRows = await db
      .select({ assertionType: trustAssertions.assertionType })
      .from(trustAssertions)
      .where(eq(trustAssertions.appId, appId))
      .all();
    const trustTypes = new Set(trustRows.map((row) => row.assertionType));
    const aliasRows = await db
      .select({ aliasType: appAliases.aliasType })
      .from(appAliases)
      .where(and(eq(appAliases.appId, appId), eq(appAliases.isActive, true)))
      .all();
    const aliasTypes = new Set(aliasRows.map((row) => row.aliasType));
    const items = rows.map((row) =>
      Object.assign({}, row, {
        trustWarnings: latestReleaseTrustWarnings({
          installStrategy: row.installStrategy,
          artifact: row.artifactId ? artifactById.get(row.artifactId) : undefined,
          trustTypes,
          aliasTypes,
        }),
      }),
    );
    return { items };
  });

// POST /apps/:id/recompute-latest
export const recomputeLatest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      appId: z.string().min(1),
      channel: z.string().optional(),
    }),
  )
  .handler(async ({ data: { appId, channel } }) => {
    await pipelineWorker.recomputeLatest({ appId, channel });
    return { status: "queued" };
  });
