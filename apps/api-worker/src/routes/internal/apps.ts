import { createDb } from "@macupdater/db";
import {
  apps,
  appAliases,
  appLatestReleases,
  sources,
  releases,
  installRules,
  auditLog,
  generateId,
  idPrefixes,
} from "@macupdater/schema";
import {
  paginationSchema,
  appCreateSchema,
  appUpdateSchema,
  aliasCreateSchema,
  installRuleCreateSchema,
} from "@macupdater/validation";
import { eq, like, sql, and, desc } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../../env";

export const appsRoutes = new Hono<{ Bindings: Env }>();

// GET /apps - list
appsRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const status = c.req.query("status");
  const search = c.req.query("search");

  const conditions = [];
  if (status)
    conditions.push(eq(apps.status, status as "active" | "deprecated" | "merged" | "unlisted"));
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

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});

// GET /apps/:id - detail
appsRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");

  const app = await db.select().from(apps).where(eq(apps.id, id)).get();
  if (!app) return c.json({ error: "App not found" }, 404);

  const latest = await db
    .select()
    .from(appLatestReleases)
    .where(eq(appLatestReleases.appId, id))
    .all();
  const [sourceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sources)
    .where(eq(sources.appId, id));

  return c.json({ ...app, latestReleases: latest, sourceCount: sourceCount?.count ?? 0 });
});

// POST /apps - create
appsRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = appCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const id = generateId(idPrefixes.app);

  await db.insert(apps).values({
    id,
    slug: parsed.data.slug,
    canonicalName: parsed.data.canonicalName,
    vendorName: parsed.data.vendorName ?? null,
    homepageUrl: parsed.data.homepageUrl ?? null,
    notes: parsed.data.notes ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "app_created",
    actorType: "admin",
    actorId: null,
    targetType: "app",
    targetId: id,
    payloadJson: JSON.stringify(parsed.data),
    createdAt: now,
  });

  return c.json({ id, status: "created" }, 201);
});

// PATCH /apps/:id - update
appsRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = appUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const existing = await db.select().from(apps).where(eq(apps.id, id)).get();
  if (!existing) return c.json({ error: "App not found" }, 404);

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (parsed.data.canonicalName !== undefined) updates.canonicalName = parsed.data.canonicalName;
  if (parsed.data.vendorName !== undefined) updates.vendorName = parsed.data.vendorName;
  if (parsed.data.homepageUrl !== undefined) updates.homepageUrl = parsed.data.homepageUrl;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.mergedIntoAppId !== undefined)
    updates.mergedIntoAppId = parsed.data.mergedIntoAppId;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

  await db.update(apps).set(updates).where(eq(apps.id, id));

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "app_updated",
    actorType: "admin",
    actorId: null,
    targetType: "app",
    targetId: id,
    payloadJson: JSON.stringify(parsed.data),
    createdAt: now,
  });

  return c.json({ status: "updated" });
});

// GET /apps/:id/aliases
appsRoutes.get("/:id/aliases", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const items = await db.select().from(appAliases).where(eq(appAliases.appId, id)).all();
  return c.json({ items });
});

// POST /apps/:id/aliases
appsRoutes.post("/:id/aliases", async (c) => {
  const appId = c.req.param("id");
  const body = await c.req.json();
  const parsed = aliasCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const id = generateId(idPrefixes.alias);

  await db.insert(appAliases).values({
    id,
    appId,
    aliasType: parsed.data.aliasType,
    value: parsed.data.value,
    normalizedValue: parsed.data.normalizedValue ?? parsed.data.value.toLowerCase(),
    isExact: parsed.data.isExact,
    priority: parsed.data.priority,
    confidenceWeight: parsed.data.confidenceWeight,
    source: parsed.data.source ?? null,
    isActive: true,
    createdAt: now,
  });

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "alias_created",
    actorType: "admin",
    actorId: null,
    targetType: "alias",
    targetId: id,
    payloadJson: JSON.stringify({ appId, ...parsed.data }),
    createdAt: now,
  });

  return c.json({ id, status: "created" }, 201);
});

// GET /apps/:id/sources
appsRoutes.get("/:id/sources", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const items = await db.select().from(sources).where(eq(sources.appId, id)).all();
  return c.json({ items });
});

// GET /apps/:id/releases
appsRoutes.get("/:id/releases", async (c) => {
  const db = createDb(c.env.DB);
  const appId = c.req.param("id");
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const channel = c.req.query("channel");
  const status = c.req.query("status");

  const conditions = [eq(releases.appId, appId)];
  if (channel) conditions.push(eq(releases.channel, channel as "stable" | "beta" | "nightly"));
  if (status)
    conditions.push(eq(releases.status, status as "active" | "retracted" | "superseded" | "draft"));

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

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});

// GET /apps/:id/latest
appsRoutes.get("/:id/latest", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const items = await db
    .select()
    .from(appLatestReleases)
    .where(eq(appLatestReleases.appId, id))
    .all();
  return c.json({ items });
});

// GET /apps/:id/install-rules
appsRoutes.get("/:id/install-rules", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const items = await db.select().from(installRules).where(eq(installRules.appId, id)).all();
  return c.json({ items });
});

// POST /apps/:id/install-rules
appsRoutes.post("/:id/install-rules", async (c) => {
  const appId = c.req.param("id");
  const body = await c.req.json();
  const parsed = installRuleCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const id = generateId(idPrefixes.installRule);

  await db.insert(installRules).values({
    id,
    appId,
    strategy: parsed.data.strategy,
    requiresQuit: parsed.data.requiresQuit,
    requiresAdmin: parsed.data.requiresAdmin,
    supportsSilent: parsed.data.supportsSilent,
    rollbackSupported: parsed.data.rollbackSupported,
    ruleConfidence: parsed.data.ruleConfidence ?? null,
    enabled: true,
    notes: parsed.data.notes ?? null,
    createdAt: now,
    updatedAt: now,
  });

  return c.json({ id, status: "created" }, 201);
});
