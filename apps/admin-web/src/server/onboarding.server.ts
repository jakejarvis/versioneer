import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import {
  apps,
  appAliases,
  sources,
  onboardingChecklists,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import {
  appCreateSchema,
  aliasCreateSchema,
  sourceCreateSchema,
  onboardingChecklistUpdateSchema,
} from "@versioneer/validation";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

// GET /onboarding/:appId - detail
export const getOnboardingChecklist = createServerFn({ method: "GET" })
  .inputValidator(z.object({ appId: z.string().min(1) }))
  .handler(async ({ data: { appId } }) => {
    const db = createDb(env.DB);
    const checklist = await db
      .select()
      .from(onboardingChecklists)
      .where(eq(onboardingChecklists.appId, appId))
      .get();
    if (!checklist) throw new Error("Not found");
    return checklist;
  });

// PATCH /onboarding/:appId - update checklist, auto-mark complete
export const updateOnboardingChecklist = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(onboardingChecklistUpdateSchema.extend({ appId: z.string().min(1) }))
  .handler(async ({ data }) => {
    const { appId, ...fields } = data;
    const db = createDb(env.DB);

    const existing = await db
      .select()
      .from(onboardingChecklists)
      .where(eq(onboardingChecklists.appId, appId))
      .get();
    if (!existing) throw new Error("Not found");

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { updatedAt: now };
    for (const [key, value] of Object.entries(fields)) {
      if (value !== undefined) updates[key] = value;
    }

    // Check if all items are complete
    const merged = { ...existing, ...fields };
    const allComplete =
      merged.hasCanonicalRecord &&
      merged.hasAliases &&
      merged.hasSource &&
      merged.parserOutputVerified &&
      merged.latestReleasePublished &&
      merged.reviewQueueClear &&
      merged.qualityScoreAcceptable;

    if (allComplete && !existing.isComplete) {
      updates.isComplete = true;
      updates.completedAt = now;
    }

    await db
      .update(onboardingChecklists)
      .set(updates)
      .where(eq(onboardingChecklists.id, existing.id));

    return { status: "updated" };
  });

// POST /onboarding - full onboarding workflow: create app + aliases + source + checklist
const onboardingCreateSchema = z.object({
  app: appCreateSchema,
  aliases: z.array(aliasCreateSchema).optional(),
  source: sourceCreateSchema.omit({ appId: true }).optional(),
});

export const onboardApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(onboardingCreateSchema)
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const appId = generateId(idPrefixes.app);

    // Create app
    await db.insert(apps).values({
      id: appId,
      slug: data.app.slug,
      canonicalName: data.app.canonicalName,
      vendorName: data.app.vendorName ?? null,
      homepageUrl: data.app.homepageUrl ?? null,
      notes: data.app.notes ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    let hasAliases = false;
    let hasSource = false;

    // Create aliases
    if (data.aliases && data.aliases.length > 0) {
      for (const aliasData of data.aliases) {
        await db.insert(appAliases).values({
          id: generateId(idPrefixes.alias),
          appId,
          aliasType: aliasData.aliasType,
          value: aliasData.value,
          normalizedValue: aliasData.normalizedValue ?? aliasData.value.toLowerCase(),
          isExact: aliasData.isExact,
          priority: aliasData.priority,
          confidenceWeight: aliasData.confidenceWeight,
          source: aliasData.source ?? null,
          isActive: true,
          createdAt: now,
        });
      }
      hasAliases = true;
    }

    // Create source
    if (data.source) {
      const sourceData = data.source;
      await db.insert(sources).values({
        id: generateId(idPrefixes.source),
        appId,
        sourceType: sourceData.sourceType,
        label: sourceData.label ?? null,
        baseUrl: sourceData.baseUrl ?? null,
        configJson: sourceData.configJson ?? null,
        parserKey: sourceData.parserKey,
        pollIntervalMinutes: sourceData.pollIntervalMinutes,
        status: "active",
        createdAt: now,
        updatedAt: now,
      });
      hasSource = true;
    }

    // Create onboarding checklist
    await db.insert(onboardingChecklists).values({
      id: generateId(idPrefixes.onboardingChecklist),
      appId,
      hasCanonicalRecord: true,
      hasAliases,
      hasSource,
      createdAt: now,
      updatedAt: now,
    });

    // Audit log
    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "app_onboarded",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "app",
      targetId: appId,
      payloadJson: JSON.stringify({ aliases: data.aliases?.length ?? 0, hasSource }),
      createdAt: now,
    });

    return { id: appId, status: "onboarded" };
  });
