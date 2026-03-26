import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import {
  apps,
  appAliases,
  appLatestReleases,
  appScorecards,
  sources,
  releases,
  installRules,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import {
  appCreateSchema,
  appUpdateSchema,
  aliasCreateSchema,
  installRuleCreateSchema,
} from "@versioneer/validation";
import { env } from "cloudflare:workers";
import { eq, like, sql, and, desc } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

// GET /apps - list with pagination, status/search filters
export const listApps = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["active", "deprecated", "merged", "unlisted"]).optional(),
      search: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const { limit, offset, status, search } = data;

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
      .orderBy(desc(apps.updatedAt))
      .limit(limit)
      .offset(offset);

    return { items, total: countResult?.count ?? 0, limit, offset };
  });

// GET /apps/:id - detail with latestReleases, sourceCount, scorecard
export const getApp = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);

    const app = await db.select().from(apps).where(eq(apps.id, id)).get();
    if (!app) throw new Error("Not found");

    const latest = await db
      .select()
      .from(appLatestReleases)
      .where(eq(appLatestReleases.appId, id))
      .all();
    const [sourceCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(sources)
      .where(eq(sources.appId, id));
    const scorecard = await db
      .select()
      .from(appScorecards)
      .where(eq(appScorecards.appId, id))
      .get();

    return {
      ...app,
      latestReleases: latest,
      sourceCount: sourceCount?.count ?? 0,
      scorecard: scorecard ?? null,
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
      status: "active",
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
    if (fields.verificationTier !== undefined) updates.verificationTier = fields.verificationTier;
    if (fields.qualityState !== undefined) updates.qualityState = fields.qualityState;
    if (fields.iconR2Key !== undefined) updates.iconR2Key = fields.iconR2Key;
    if (fields.lastReviewedAt !== undefined) updates.lastReviewedAt = fields.lastReviewedAt;

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

    await db.insert(appAliases).values({
      id,
      appId,
      aliasType: aliasData.aliasType,
      value: aliasData.value,
      normalizedValue: aliasData.normalizedValue ?? aliasData.value.toLowerCase(),
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
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data: { appId } }) => {
    const db = createDb(env.DB);
    const items = await db.select().from(sources).where(eq(sources.appId, appId)).all();
    return { items };
  });

// GET /apps/:id/releases - paginated with filters
export const getAppReleases = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      appId: z.string().min(1),
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      channel: z.enum(["stable", "beta", "nightly"]).optional(),
      status: z.enum(["active", "retracted", "superseded", "draft"]).optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { appId, limit, offset, channel, status } = data;
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
      .orderBy(desc(releases.createdAt))
      .limit(limit)
      .offset(offset);

    return { items, total: countResult?.count ?? 0, limit, offset };
  });

// GET /apps/:id/latest
export const getAppLatest = createServerFn({ method: "GET" })
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data: { appId } }) => {
    const db = createDb(env.DB);
    const items = await db
      .select()
      .from(appLatestReleases)
      .where(eq(appLatestReleases.appId, appId))
      .all();
    return { items };
  });

// GET /apps/:id/install-rules
export const getAppInstallRules = createServerFn({ method: "GET" })
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data: { appId } }) => {
    const db = createDb(env.DB);
    const items = await db.select().from(installRules).where(eq(installRules.appId, appId)).all();
    return { items };
  });

// POST /apps/:id/install-rules
export const createInstallRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(installRuleCreateSchema.extend({ appId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { appId, ...ruleData } = data;
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const id = generateId(idPrefixes.installRule);

    await db.insert(installRules).values({
      id,
      appId,
      strategy: ruleData.strategy,
      requiresQuit: ruleData.requiresQuit,
      requiresAdmin: ruleData.requiresAdmin,
      supportsSilent: ruleData.supportsSilent,
      rollbackSupported: ruleData.rollbackSupported,
      ruleConfidence: ruleData.ruleConfidence ?? null,
      enabled: true,
      notes: ruleData.notes ?? null,
      createdAt: now,
      updatedAt: now,
    });

    return { id, status: "created" };
  });

// POST /apps/:id/recompute-latest
export const recomputeLatest = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      appId: z.string().min(1),
      channel: z.enum(["stable", "beta", "nightly"]).optional(),
    }),
  )
  .handler(async ({ data: { appId, channel } }) => {
    await env.RECOMPUTE_LATEST_QUEUE.send({ appId, channel });
    return { status: "queued" };
  });
