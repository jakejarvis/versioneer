import { Hono } from "hono";
import { eq } from "drizzle-orm";
import type { Env } from "../../env";
import { createDb } from "@macupdater/db";
import { installRules } from "@macupdater/schema";
import { installRuleUpdateSchema } from "@macupdater/validation";

export const installRulesRoutes = new Hono<{ Bindings: Env }>();

// PATCH /install-rules/:id
installRulesRoutes.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = installRuleUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const existing = await db.select().from(installRules).where(eq(installRules.id, id)).get();
  if (!existing) return c.json({ error: "Install rule not found" }, 404);

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };
  if (parsed.data.strategy !== undefined) updates.strategy = parsed.data.strategy;
  if (parsed.data.requiresQuit !== undefined) updates.requiresQuit = parsed.data.requiresQuit;
  if (parsed.data.requiresAdmin !== undefined) updates.requiresAdmin = parsed.data.requiresAdmin;
  if (parsed.data.supportsSilent !== undefined) updates.supportsSilent = parsed.data.supportsSilent;
  if (parsed.data.rollbackSupported !== undefined) updates.rollbackSupported = parsed.data.rollbackSupported;
  if (parsed.data.ruleConfidence !== undefined) updates.ruleConfidence = parsed.data.ruleConfidence;
  if (parsed.data.enabled !== undefined) updates.enabled = parsed.data.enabled;
  if (parsed.data.notes !== undefined) updates.notes = parsed.data.notes;

  await db.update(installRules).set(updates).where(eq(installRules.id, id));
  return c.json({ status: "updated" });
});

// DELETE /install-rules/:id
installRulesRoutes.delete("/:id", async (c) => {
  const id = c.req.param("id");
  const db = createDb(c.env.DB);
  const existing = await db.select().from(installRules).where(eq(installRules.id, id)).get();
  if (!existing) return c.json({ error: "Install rule not found" }, 404);

  await db.delete(installRules).where(eq(installRules.id, id));
  return c.json({ status: "deleted" });
});
