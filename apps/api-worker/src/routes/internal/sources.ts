import { createDb } from "@versioneer/db";
import {
  sources,
  sourceFetches,
  parserRuns,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { paginationSchema, sourceCreateSchema, sourceUpdateSchema } from "@versioneer/validation";
import { eq, and, sql, desc } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../../env";

export const sourcesRoutes = new Hono<{ Bindings: Env }>();

// GET /sources - list
sourcesRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const status = c.req.query("status");
  const sourceType = c.req.query("sourceType");
  const appId = c.req.query("appId");

  const conditions = [];
  if (status)
    conditions.push(eq(sources.status, status as "active" | "paused" | "disabled" | "error"));
  if (sourceType)
    conditions.push(eq(sources.sourceType, sourceType as "sparkle" | "github_releases" | "manual"));
  if (appId) conditions.push(eq(sources.appId, appId));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sources)
    .where(where);
  const items = await db
    .select()
    .from(sources)
    .where(where)
    .orderBy(desc(sources.updatedAt))
    .limit(limit)
    .offset(offset);

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});

// GET /sources/:id - detail
sourcesRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const source = await db.select().from(sources).where(eq(sources.id, id)).get();
  if (!source) return c.json({ error: "Source not found" }, 404);
  return c.json(source);
});

// POST /sources - create
sourcesRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = sourceCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const id = generateId(idPrefixes.source);

  await db.insert(sources).values({
    id,
    appId: parsed.data.appId,
    sourceType: parsed.data.sourceType,
    label: parsed.data.label ?? null,
    baseUrl: parsed.data.baseUrl ?? null,
    configJson: parsed.data.configJson ?? null,
    parserKey: parsed.data.parserKey,
    pollIntervalMinutes: parsed.data.pollIntervalMinutes,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "source_created",
    actorType: "admin",
    actorId: null,
    targetType: "source",
    targetId: id,
    payloadJson: JSON.stringify(parsed.data),
    createdAt: now,
  });

  return c.json({ id, status: "created" }, 201);
});

// PATCH /sources/:id - update
sourcesRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = sourceUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const existing = await db.select().from(sources).where(eq(sources.id, id)).get();
  if (!existing) return c.json({ error: "Source not found" }, 404);

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (parsed.data.label !== undefined) updates.label = parsed.data.label;
  if (parsed.data.baseUrl !== undefined) updates.baseUrl = parsed.data.baseUrl;
  if (parsed.data.configJson !== undefined) updates.configJson = parsed.data.configJson;
  if (parsed.data.parserKey !== undefined) updates.parserKey = parsed.data.parserKey;
  if (parsed.data.pollIntervalMinutes !== undefined)
    updates.pollIntervalMinutes = parsed.data.pollIntervalMinutes;
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;

  await db.update(sources).set(updates).where(eq(sources.id, id));

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "source_updated",
    actorType: "admin",
    actorId: null,
    targetType: "source",
    targetId: id,
    payloadJson: JSON.stringify(parsed.data),
    createdAt: now,
  });

  return c.json({ status: "updated" });
});

// POST /sources/:id/fetch - trigger fetch (existing)
sourcesRoutes.post("/:id/fetch", async (c) => {
  const sourceId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const reason = (body as Record<string, string>).reason ?? "manual";
  const force = (body as Record<string, boolean>).force ?? false;

  const db = createDb(c.env.DB);
  const source = await db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!source) return c.json({ error: "Source not found" }, 404);

  await c.env.SOURCE_FETCH_QUEUE.send({ sourceId, reason, force });
  return c.json({ status: "queued", sourceId });
});

// GET /sources/:id/fetches - fetch history
sourcesRoutes.get("/:id/fetches", async (c) => {
  const db = createDb(c.env.DB);
  const sourceId = c.req.param("id");
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sourceFetches)
    .where(eq(sourceFetches.sourceId, sourceId));
  const items = await db
    .select()
    .from(sourceFetches)
    .where(eq(sourceFetches.sourceId, sourceId))
    .orderBy(desc(sourceFetches.fetchedAt))
    .limit(limit)
    .offset(offset);

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});

// GET /source-fetches/:id - single fetch
sourcesRoutes.get("/fetches/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const fetch = await db.select().from(sourceFetches).where(eq(sourceFetches.id, id)).get();
  if (!fetch) return c.json({ error: "Source fetch not found" }, 404);
  return c.json(fetch);
});

// POST /source-fetches/:id/reparse (existing)
sourcesRoutes.post("/fetches/:id/reparse", async (c) => {
  const sourceFetchId = c.req.param("id");
  await c.env.SOURCE_PARSE_QUEUE.send({ sourceFetchId });
  return c.json({ status: "queued", sourceFetchId });
});

// GET /source-fetches/:id/parser-runs
sourcesRoutes.get("/fetches/:id/parser-runs", async (c) => {
  const db = createDb(c.env.DB);
  const fetchId = c.req.param("id");
  const items = await db
    .select()
    .from(parserRuns)
    .where(eq(parserRuns.sourceFetchId, fetchId))
    .orderBy(desc(parserRuns.startedAt))
    .all();
  return c.json({ items });
});
