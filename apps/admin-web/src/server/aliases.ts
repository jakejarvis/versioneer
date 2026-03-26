import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { appAliases, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { aliasUpdateSchema } from "@versioneer/validation";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

export const updateAlias = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string() }).merge(aliasUpdateSchema))
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const existing = await db.select().from(appAliases).where(eq(appAliases.id, data.id)).get();
    if (!existing) throw new Error("Not found");

    const updates: Record<string, unknown> = {};
    if (data.isActive !== undefined) updates.isActive = data.isActive;
    if (data.priority !== undefined) updates.priority = data.priority;
    if (data.confidenceWeight !== undefined) updates.confidenceWeight = data.confidenceWeight;

    await db.update(appAliases).set(updates).where(eq(appAliases.id, data.id));

    return { status: "updated" };
  });

export const deleteAlias = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const existing = await db.select().from(appAliases).where(eq(appAliases.id, data.id)).get();
    if (!existing) throw new Error("Not found");

    await db.delete(appAliases).where(eq(appAliases.id, data.id));

    const now = new Date().toISOString();
    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "alias_deleted",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "alias",
      targetId: data.id,
      payloadJson: JSON.stringify({
        appId: existing.appId,
        aliasType: existing.aliasType,
        value: existing.value,
      }),
      createdAt: now,
    });

    return { status: "deleted" };
  });
