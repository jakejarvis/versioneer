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
import { paginationSchema, releaseUpdateSchema } from "@versioneer/validation";
import { eq, and, sql, desc } from "drizzle-orm";
import { Hono } from "hono";

import type { AppEnv } from "../../env";

export const releasesRoutes = new Hono<AppEnv>();

// GET /releases - list
releasesRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const appId = c.req.query("appId");
  const channel = c.req.query("channel");
  const status = c.req.query("status");

  const conditions = [];
  if (appId) conditions.push(eq(releases.appId, appId));
  if (channel) conditions.push(eq(releases.channel, channel as "stable" | "beta" | "nightly"));
  if (status)
    conditions.push(eq(releases.status, status as "active" | "retracted" | "superseded" | "draft"));

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

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});

// GET /releases/:id - detail
releasesRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const release = await db.select().from(releases).where(eq(releases.id, id)).get();
  if (!release) return c.json({ error: "Release not found" }, 404);
  return c.json(release);
});

// PATCH /releases/:id - update status
releasesRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = releaseUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const existing = await db.select().from(releases).where(eq(releases.id, id)).get();
  if (!existing) return c.json({ error: "Release not found" }, 404);

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (parsed.data.status !== undefined) updates.status = parsed.data.status;
  if (parsed.data.channel !== undefined) updates.channel = parsed.data.channel;

  await db.update(releases).set(updates).where(eq(releases.id, id));

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "release_updated",
    actorType: "admin",
    actorId: c.get("user").email,
    targetType: "release",
    targetId: id,
    payloadJson: JSON.stringify(parsed.data),
    createdAt: now,
  });

  return c.json({ status: "updated" });
});

// GET /releases/:id/artifacts
releasesRoutes.get("/:id/artifacts", async (c) => {
  const db = createDb(c.env.DB);
  const releaseId = c.req.param("id");
  const items = await db.select().from(artifacts).where(eq(artifacts.releaseId, releaseId)).all();
  return c.json({ items });
});

// POST /artifacts/:id/verify (existing)
releasesRoutes.post("/artifacts/:id/verify", async (c) => {
  const artifactId = c.req.param("id");
  await c.env.ARTIFACT_VERIFY_QUEUE.send({ artifactId });
  return c.json({ status: "queued", artifactId });
});

// POST /releases/:id/pin
releasesRoutes.post("/:id/pin", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.DB);
  const release = await db.select().from(releases).where(eq(releases.id, id)).get();
  if (!release) return c.json({ error: "Release not found" }, 404);

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
    createdBy: c.get("user").email,
    isActive: true,
    createdAt: now,
  });

  await c.env.RECOMPUTE_LATEST_QUEUE.send({ appId: release.appId, channel: release.channel });

  return c.json({ status: "pinned" });
});

// POST /releases/:id/unpin
releasesRoutes.post("/:id/unpin", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.DB);
  const release = await db.select().from(releases).where(eq(releases.id, id)).get();
  if (!release) return c.json({ error: "Release not found" }, 404);

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

  await c.env.RECOMPUTE_LATEST_QUEUE.send({ appId: release.appId, channel: release.channel });

  return c.json({ status: "unpinned" });
});

// GET /releases/:id/observations
releasesRoutes.get("/:id/observations", async (c) => {
  const db = createDb(c.env.DB);
  const releaseId = c.req.param("id");
  const items = await db
    .select()
    .from(releaseObservations)
    .where(eq(releaseObservations.releaseId, releaseId))
    .orderBy(desc(releaseObservations.createdAt))
    .all();
  return c.json({ items });
});
