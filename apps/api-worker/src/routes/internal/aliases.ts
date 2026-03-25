import { createDb } from "@macupdater/db";
import { appAliases, auditLog, generateId, idPrefixes } from "@macupdater/schema";
import { aliasUpdateSchema } from "@macupdater/validation";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../../env";

export const aliasesRoutes = new Hono<{ Bindings: Env }>();

// PATCH /aliases/:id
aliasesRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = aliasUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const existing = await db.select().from(appAliases).where(eq(appAliases.id, id)).get();
  if (!existing) return c.json({ error: "Alias not found" }, 404);

  const updates: Record<string, unknown> = {};
  if (parsed.data.isActive !== undefined) updates.isActive = parsed.data.isActive;
  if (parsed.data.priority !== undefined) updates.priority = parsed.data.priority;
  if (parsed.data.confidenceWeight !== undefined)
    updates.confidenceWeight = parsed.data.confidenceWeight;

  await db.update(appAliases).set(updates).where(eq(appAliases.id, id));

  return c.json({ status: "updated" });
});

// DELETE /aliases/:id
aliasesRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.DB);

  const existing = await db.select().from(appAliases).where(eq(appAliases.id, id)).get();
  if (!existing) return c.json({ error: "Alias not found" }, 404);

  await db.delete(appAliases).where(eq(appAliases.id, id));

  const now = new Date().toISOString();
  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "alias_deleted",
    actorType: "admin",
    actorId: null,
    targetType: "alias",
    targetId: id,
    payloadJson: JSON.stringify({
      appId: existing.appId,
      aliasType: existing.aliasType,
      value: existing.value,
    }),
    createdAt: now,
  });

  return c.json({ status: "deleted" });
});
