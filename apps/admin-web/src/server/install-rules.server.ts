import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { installRules } from "@versioneer/schema";
import { installRuleUpdateSchema } from "@versioneer/validation";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

export const updateInstallRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string() }).merge(installRuleUpdateSchema))
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const existing = await db.select().from(installRules).where(eq(installRules.id, data.id)).get();
    if (!existing) throw new Error("Not found");

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: now };
    if (data.strategy !== undefined) updates.strategy = data.strategy;
    if (data.requiresQuit !== undefined) updates.requiresQuit = data.requiresQuit;
    if (data.requiresAdmin !== undefined) updates.requiresAdmin = data.requiresAdmin;
    if (data.supportsSilent !== undefined) updates.supportsSilent = data.supportsSilent;
    if (data.rollbackSupported !== undefined) updates.rollbackSupported = data.rollbackSupported;
    if (data.ruleConfidence !== undefined) updates.ruleConfidence = data.ruleConfidence;
    if (data.enabled !== undefined) updates.enabled = data.enabled;
    if (data.notes !== undefined) updates.notes = data.notes;

    await db.update(installRules).set(updates).where(eq(installRules.id, data.id));
    return { status: "updated" };
  });

export const deleteInstallRule = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const existing = await db.select().from(installRules).where(eq(installRules.id, data.id)).get();
    if (!existing) throw new Error("Not found");

    await db.delete(installRules).where(eq(installRules.id, data.id));
    return { status: "deleted" };
  });
