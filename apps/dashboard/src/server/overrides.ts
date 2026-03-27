import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { adminOverrides, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { overrideCreateSchema } from "@versioneer/validation";
import { env } from "cloudflare:workers";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { resolveTargetRefs } from "./entity-summaries";
import { authMiddleware } from "./middleware";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function overrideOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "overrideType":
      return [direction(adminOverrides.overrideType), desc(adminOverrides.createdAt)];
    case "targetType":
      return [direction(adminOverrides.targetType), desc(adminOverrides.createdAt)];
    case "isActive":
      return [direction(adminOverrides.isActive), desc(adminOverrides.createdAt)];
    case "createdAt":
    default:
      return [desc(adminOverrides.createdAt)];
  }
}

export const listOverrides = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      active: z.boolean().optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    let where;
    if (data.active === true) where = eq(adminOverrides.isActive, true);
    else if (data.active === false) where = eq(adminOverrides.isActive, false);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(adminOverrides)
      .where(where);
    const items = await db
      .select()
      .from(adminOverrides)
      .where(where)
      .orderBy(...overrideOrderBy(data.sortBy, data.sortDir))
      .limit(limit)
      .offset(offset);
    const targetRefMap = await resolveTargetRefs(
      db,
      items.map((item) => ({
        targetType: item.targetType,
        targetId: item.targetId,
      })),
    );

    return {
      items: items.map((item) =>
        Object.assign({}, item, {
          targetRef: targetRefMap.get(`${item.targetType}:${item.targetId}`) ?? null,
        }),
      ),
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  });

export const getOverride = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const item = await db.select().from(adminOverrides).where(eq(adminOverrides.id, data.id)).get();
    if (!item) throw new Error("Not found");
    return item;
  });

export const createOverride = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(overrideCreateSchema)
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const id = generateId(idPrefixes.adminOverride);

    await db.insert(adminOverrides).values({
      id,
      overrideType: data.overrideType,
      targetType: data.targetType,
      targetId: data.targetId,
      payloadJson: data.payloadJson,
      reason: data.reason ?? null,
      createdBy: context.user.email,
      isActive: true,
      createdAt: now,
    });

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "override_created",
      actorType: "admin",
      actorId: context.user.email,
      targetType: data.targetType,
      targetId: data.targetId,
      payloadJson: data.payloadJson,
      createdAt: now,
    });

    return { id, status: "created" };
  });

export const deactivateOverride = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const existing = await db
      .select()
      .from(adminOverrides)
      .where(eq(adminOverrides.id, data.id))
      .get();
    if (!existing) throw new Error("Not found");

    await db.update(adminOverrides).set({ isActive: false }).where(eq(adminOverrides.id, data.id));

    const now = new Date().toISOString();
    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "override_deactivated",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "override",
      targetId: data.id,
      payloadJson: null,
      createdAt: now,
    });

    return { status: "deactivated" };
  });
