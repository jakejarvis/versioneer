import { createDb } from "@versioneer/db";
import { adminOverrides, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { paginationSchema, overrideCreateSchema } from "@versioneer/validation";
import { eq, sql, desc } from "drizzle-orm";
import { Hono } from "hono";

import type { AppEnv } from "../../env";

export const overridesRoutes = new Hono<AppEnv>();

// GET /overrides - list
overridesRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const active = c.req.query("active");

  let where;
  if (active === "true") where = eq(adminOverrides.isActive, true);
  else if (active === "false") where = eq(adminOverrides.isActive, false);

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(adminOverrides)
    .where(where);
  const items = await db
    .select()
    .from(adminOverrides)
    .where(where)
    .orderBy(desc(adminOverrides.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});

// GET /overrides/:id
overridesRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const item = await db.select().from(adminOverrides).where(eq(adminOverrides.id, id)).get();
  if (!item) return c.json({ error: "Override not found" }, 404);
  return c.json(item);
});

// POST /overrides - create (migrated from old internal.ts)
overridesRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = overrideCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const id = generateId(idPrefixes.adminOverride);

  await db.insert(adminOverrides).values({
    id,
    overrideType: parsed.data.overrideType,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    payloadJson: parsed.data.payloadJson,
    reason: parsed.data.reason ?? null,
    createdBy: c.get("user").email,
    isActive: true,
    createdAt: now,
  });

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "override_created",
    actorType: "admin",
    actorId: c.get("user").email,
    targetType: parsed.data.targetType,
    targetId: parsed.data.targetId,
    payloadJson: parsed.data.payloadJson,
    createdAt: now,
  });

  return c.json({ id, status: "created" }, 201);
});

// PATCH /overrides/:id - deactivate
overridesRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.DB);

  const existing = await db.select().from(adminOverrides).where(eq(adminOverrides.id, id)).get();
  if (!existing) return c.json({ error: "Override not found" }, 404);

  await db.update(adminOverrides).set({ isActive: false }).where(eq(adminOverrides.id, id));

  const now = new Date().toISOString();
  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "override_deactivated",
    actorType: "admin",
    actorId: c.get("user").email,
    targetType: "override",
    targetId: id,
    payloadJson: null,
    createdAt: now,
  });

  return c.json({ status: "deactivated" });
});
