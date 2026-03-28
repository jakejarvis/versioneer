import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import {
  sources,
  sourceFetches,
  parserRuns,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { sourceCreateSchema, sourceUpdateSchema } from "@versioneer/validation";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { loadAppsByIds, toAppSummary } from "./entity-summaries";
import { authMiddleware } from "./middleware";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function sourceOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "label":
      return [direction(sources.label), desc(sources.updatedAt)];
    case "sourceType":
      return [direction(sources.sourceType), desc(sources.updatedAt)];
    case "parserKey":
      return [direction(sources.parserKey), desc(sources.updatedAt)];
    case "status":
      return [direction(sources.status), desc(sources.updatedAt)];
    case "pollIntervalMinutes":
      return [direction(sources.pollIntervalMinutes), desc(sources.updatedAt)];
    case "lastFetchedAt":
      return [direction(sources.lastFetchedAt), desc(sources.updatedAt)];
    case "lastSuccessAt":
      return [direction(sources.lastSuccessAt), desc(sources.updatedAt)];
    case "updatedAt":
    default:
      return [desc(sources.updatedAt)];
  }
}

function sourceFetchOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "fetchStatus":
      return [direction(sourceFetches.fetchStatus), desc(sourceFetches.fetchedAt)];
    case "httpStatus":
      return [direction(sourceFetches.httpStatus), desc(sourceFetches.fetchedAt)];
    case "fetchedAt":
    default:
      return [desc(sourceFetches.fetchedAt)];
  }
}

// GET /sources - list with pagination and filters
export const listSources = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["active", "paused", "disabled", "error"]).optional(),
      sourceType: z.enum(["sparkle", "github_releases", "manual", "homebrew_cask"]).optional(),
      appId: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, status, sourceType, appId, sortBy, sortDir } = data;
    const db = createDb(env.DB);

    const conditions = [];
    if (status) conditions.push(eq(sources.status, status));
    if (sourceType) conditions.push(eq(sources.sourceType, sourceType));
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
      .orderBy(...sourceOrderBy(sortBy, sortDir))
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

    await db.insert(sources).values({
      id,
      appId: data.appId,
      sourceType: data.sourceType,
      label: data.label ?? null,
      baseUrl: data.baseUrl ?? null,
      configJson: data.configJson ?? null,
      parserKey: data.parserKey,
      channel: data.channel ?? null,
      pollIntervalMinutes: data.pollIntervalMinutes,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "source_created",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "source",
      targetId: id,
      payloadJson: JSON.stringify(data),
      createdAt: now,
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
    if (fields.label !== undefined) updates.label = fields.label;
    if (fields.baseUrl !== undefined) updates.baseUrl = fields.baseUrl;
    if (fields.configJson !== undefined) updates.configJson = fields.configJson;
    if (fields.parserKey !== undefined) updates.parserKey = fields.parserKey;
    if (fields.pollIntervalMinutes !== undefined)
      updates.pollIntervalMinutes = fields.pollIntervalMinutes;
    if (fields.channel !== undefined) updates.channel = fields.channel;
    if (fields.status !== undefined) updates.status = fields.status;

    await db.update(sources).set(updates).where(eq(sources.id, id));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "source_updated",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "source",
      targetId: id,
      payloadJson: JSON.stringify(fields),
      createdAt: now,
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
  .handler(async ({ data: { sourceId, reason, force } }) => {
    const db = createDb(env.DB);
    const source = await db.select().from(sources).where(eq(sources.id, sourceId)).get();
    if (!source) throw new Error("Not found");

    await env.SOURCE_FETCH_QUEUE.send({ sourceId, reason, force });
    return { status: "queued", sourceId };
  });

// GET /sources/:id/fetches - paginated fetch history
export const getSourceFetches = createServerFn({ method: "GET" })
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
  .handler(async ({ data: { sourceFetchId } }) => {
    await env.SOURCE_PARSE_QUEUE.send({ sourceFetchId });
    return { status: "queued", sourceFetchId };
  });

// GET /source-fetches/:id/parser-runs
export const getParserRuns = createServerFn({ method: "GET" })
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
