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
import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { AppEnv } from "../../env";

export const onboardingRoutes = new Hono<AppEnv>();

// GET /onboarding/:appId
onboardingRoutes.get("/:appId", async (c) => {
  const db = createDb(c.env.DB);
  const appId = c.req.param("appId");

  const checklist = await db
    .select()
    .from(onboardingChecklists)
    .where(eq(onboardingChecklists.appId, appId))
    .get();

  if (!checklist) return c.json({ error: "Onboarding checklist not found" }, 404);
  return c.json(checklist);
});

// PATCH /onboarding/:appId
onboardingRoutes.patch("/:appId", async (c) => {
  const db = createDb(c.env.DB);
  const appId = c.req.param("appId");
  const body = await c.req.json();
  const parsed = onboardingChecklistUpdateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const existing = await db
    .select()
    .from(onboardingChecklists)
    .where(eq(onboardingChecklists.appId, appId))
    .get();
  if (!existing) return c.json({ error: "Onboarding checklist not found" }, 404);

  const now = new Date().toISOString();
  const updates: Record<string, unknown> = { updatedAt: now };
  for (const [key, value] of Object.entries(parsed.data)) {
    if (value !== undefined) updates[key] = value;
  }

  // Check if all items are complete
  const merged = { ...existing, ...parsed.data };
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

  return c.json({ status: "updated" });
});

// POST /onboarding - full onboarding workflow
const onboardingCreateSchema = z.object({
  app: appCreateSchema,
  aliases: z.array(aliasCreateSchema).optional(),
  source: sourceCreateSchema.omit({ appId: true }).optional(),
});

onboardingRoutes.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = onboardingCreateSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: "Invalid input", details: parsed.error.issues }, 400);

  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const appId = generateId(idPrefixes.app);

  // Create app
  await db.insert(apps).values({
    id: appId,
    slug: parsed.data.app.slug,
    canonicalName: parsed.data.app.canonicalName,
    vendorName: parsed.data.app.vendorName ?? null,
    homepageUrl: parsed.data.app.homepageUrl ?? null,
    notes: parsed.data.app.notes ?? null,
    status: "active",
    createdAt: now,
    updatedAt: now,
  });

  let hasAliases = false;
  let hasSource = false;

  // Create aliases
  if (parsed.data.aliases && parsed.data.aliases.length > 0) {
    for (const aliasData of parsed.data.aliases) {
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
  if (parsed.data.source) {
    const sourceData = parsed.data.source;
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
    actorId: c.get("user").email,
    targetType: "app",
    targetId: appId,
    payloadJson: JSON.stringify({ aliases: parsed.data.aliases?.length ?? 0, hasSource }),
    createdAt: now,
  });

  return c.json({ id: appId, status: "onboarded" }, 201);
});
