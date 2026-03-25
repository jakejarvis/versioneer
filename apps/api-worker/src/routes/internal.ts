import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../env";
import { createDb } from "@macupdater/db";
import {
  sources,
  adminOverrides,
  reviewQueue,
  jobFailures,
  auditLog,
  generateId,
  idPrefixes,
} from "@macupdater/schema";

export const internalRoutes = new Hono<{ Bindings: Env }>();

// POST /internal/sources/:id/fetch
internalRoutes.post("/sources/:id/fetch", async (c) => {
  const sourceId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const reason = (body as Record<string, string>).reason ?? "manual";
  const force = (body as Record<string, boolean>).force ?? false;

  const db = createDb(c.env.DB);
  const source = await db.select().from(sources).where(eq(sources.id, sourceId)).get();
  if (!source) {
    return c.json({ error: "Source not found" }, 404);
  }

  await c.env.SOURCE_FETCH_QUEUE.send({
    sourceId,
    reason,
    force,
  });

  return c.json({ status: "queued", sourceId });
});

// POST /internal/source-fetches/:id/reparse
internalRoutes.post("/source-fetches/:id/reparse", async (c) => {
  const sourceFetchId = c.req.param("id");

  await c.env.SOURCE_PARSE_QUEUE.send({ sourceFetchId });

  return c.json({ status: "queued", sourceFetchId });
});

// POST /internal/artifacts/:id/verify
internalRoutes.post("/artifacts/:id/verify", async (c) => {
  const artifactId = c.req.param("id");

  await c.env.ARTIFACT_VERIFY_QUEUE.send({ artifactId });

  return c.json({ status: "queued", artifactId });
});

// POST /internal/apps/:id/recompute-latest
internalRoutes.post("/apps/:id/recompute-latest", async (c) => {
  const appId = c.req.param("id");
  const body = await c.req.json().catch(() => ({}));
  const channel = (body as Record<string, string>).channel;

  await c.env.RECOMPUTE_LATEST_QUEUE.send({
    appId,
    channel,
  });

  return c.json({ status: "queued", appId });
});

// POST /internal/overrides
internalRoutes.post("/overrides", async (c) => {
  const body = await c.req.json();
  const db = createDb(c.env.DB);
  const now = new Date().toISOString();

  const { overrideType, targetType, targetId, payloadJson, reason, createdBy } =
    body as Record<string, string>;

  const id = generateId(idPrefixes.adminOverride);

  await db.insert(adminOverrides).values({
    id,
    overrideType,
    targetType,
    targetId,
    payloadJson,
    reason: reason ?? null,
    createdBy: createdBy ?? null,
    isActive: true,
    createdAt: now,
  });

  // Audit log
  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "override_created",
    actorType: createdBy ? "admin" : "system",
    actorId: createdBy ?? null,
    targetType,
    targetId,
    payloadJson,
    createdAt: now,
  });

  return c.json({ id, status: "created" }, 201);
});

// GET /internal/review-queue
internalRoutes.get("/review-queue", async (c) => {
  const db = createDb(c.env.DB);
  const status = c.req.query("status") ?? "pending";

  const items = await db
    .select()
    .from(reviewQueue)
    .where(eq(reviewQueue.status, status as "pending" | "in_progress" | "resolved" | "dismissed"))
    .all();

  return c.json({ items });
});

// GET /internal/job-failures
internalRoutes.get("/job-failures", async (c) => {
  const db = createDb(c.env.DB);
  const status = c.req.query("status") ?? "open";

  const items = await db
    .select()
    .from(jobFailures)
    .where(eq(jobFailures.status, status as "open" | "retrying" | "resolved" | "abandoned"))
    .all();

  return c.json({ items });
});
