import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { lookupCaskTokenByBundleId } from "@versioneer/pipeline";
import {
  apps,
  appAliases,
  discoveredApps,
  sources,
  onboardingChecklists,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { onboardingChecklistUpdateSchema } from "@versioneer/validation";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

// ──────────────────────────────────────────────────────────
// Checklist queries (unchanged)
// ──────────────────────────────────────────────────────────

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

// ──────────────────────────────────────────────────────────
// Slug availability check
// ──────────────────────────────────────────────────────────

export const checkSlugAvailable = createServerFn({ method: "GET" })
  .inputValidator(z.object({ slug: z.string().min(1) }))
  .handler(async ({ data: { slug } }) => {
    const db = createDb(env.DB);
    const existing = await db.select({ id: apps.id }).from(apps).where(eq(apps.slug, slug)).get();
    return { available: !existing };
  });

// ──────────────────────────────────────────────────────────
// Atomic onboard from discovered app
// ──────────────────────────────────────────────────────────

const aliasInputSchema = z.object({
  aliasType: z.enum([
    "bundle_id",
    "name",
    "team_id",
    "sparkle_feed",
    "homepage",
    "download_pattern",
    "github_repo",
    "mas_app_id",
    "homebrew_cask",
  ]),
  value: z.string().min(1),
});

const sourceInputSchema = z.object({
  sourceType: z.enum(["sparkle", "github_releases", "manual", "homebrew_cask"]),
  baseUrl: z.string().url(),
  parserKey: z.string().min(1),
  pollIntervalMinutes: z.number().int().min(5).max(10080).default(60),
  label: z.string().optional(),
  status: z.enum(["active", "paused"]).default("active"),
});

const onboardDiscoveredAppSchema = z.object({
  discoveredAppId: z.string().min(1),
  app: z.object({
    slug: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens"),
    canonicalName: z.string().min(1).max(500),
    vendorName: z.string().max(500).optional(),
    homepageUrl: z.string().url().max(2000).optional(),
    notes: z.string().max(5000).optional(),
  }),
  aliases: z.array(aliasInputSchema),
  source: sourceInputSchema.optional(),
  sources: z.array(sourceInputSchema).optional(),
  sourceValidated: z.boolean().default(false),
  enrichmentHasReleases: z.boolean().default(false),
});

/**
 * Atomic onboard: creates app + aliases + source + checklist,
 * approves the discovered app, and enqueues the first source fetch.
 * All in a single call.
 */
export const onboardDiscoveredApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(onboardDiscoveredAppSchema)
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const appId = generateId(idPrefixes.app);

    // 0. Validate discovered app exists and hasn't been onboarded already
    const discoveredAppRow = await db
      .select()
      .from(discoveredApps)
      .where(eq(discoveredApps.id, data.discoveredAppId))
      .get();
    if (!discoveredAppRow) throw new Error("Discovered app not found");
    if (discoveredAppRow.status === "approved") throw new Error("Discovered app already onboarded");

    // 1. Create app (with icon if discovered app has one)
    let catalogIconR2Key: string | null = null;
    if (discoveredAppRow.iconR2Key) {
      try {
        const bucket = env.ASSETS_BUCKET as unknown as R2Bucket;
        const existingObject = await bucket.get(discoveredAppRow.iconR2Key);
        if (existingObject) {
          const pathParts = discoveredAppRow.iconR2Key.split("/");
          const filename = pathParts[pathParts.length - 1]!;
          catalogIconR2Key = `icons/${data.app.slug}/${filename}`;
          await bucket.put(catalogIconR2Key, existingObject.body, {
            httpMetadata: existingObject.httpMetadata,
          });
          await bucket.delete(discoveredAppRow.iconR2Key);
        }
      } catch {
        // Icon transfer is non-critical — continue with onboarding
      }
    }

    await db.insert(apps).values({
      id: appId,
      slug: data.app.slug,
      canonicalName: data.app.canonicalName,
      vendorName: data.app.vendorName ?? null,
      homepageUrl: data.app.homepageUrl ?? null,
      notes: data.app.notes ?? null,
      iconR2Key: catalogIconR2Key,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    // 2. Create aliases
    const hasAliases = data.aliases.length > 0;
    for (const alias of data.aliases) {
      await db.insert(appAliases).values({
        id: generateId(idPrefixes.alias),
        appId,
        aliasType: alias.aliasType,
        value: alias.value,
        normalizedValue: alias.value.toLowerCase(),
        isExact: true,
        priority: 0,
        confidenceWeight: 100,
        source: "onboarding",
        isActive: true,
        createdAt: now,
      });
    }

    // 3. Create sources
    let hasSource = false;
    const activeSourceIds: string[] = [];
    // Support both single `source` (backward compat) and `sources` array
    const allSources = data.sources ?? (data.source ? [data.source] : []);
    for (const src of allSources) {
      const srcId = generateId(idPrefixes.source);
      const status = src.status ?? "active";
      await db.insert(sources).values({
        id: srcId,
        appId,
        sourceType: src.sourceType,
        label: src.label ?? null,
        baseUrl: src.baseUrl,
        configJson: null,
        parserKey: src.parserKey,
        pollIntervalMinutes: src.pollIntervalMinutes,
        status,
        createdAt: now,
        updatedAt: now,
      });
      hasSource = true;
      if (status === "active") {
        activeSourceIds.push(srcId);
      }
    }

    // 4. Create onboarding checklist with auto-marked items
    await db.insert(onboardingChecklists).values({
      id: generateId(idPrefixes.onboardingChecklist),
      appId,
      hasCanonicalRecord: true,
      hasAliases,
      hasSource,
      parserOutputVerified: data.sourceValidated,
      latestReleasePublished: data.enrichmentHasReleases,
      createdAt: now,
      updatedAt: now,
    });

    // 5. Approve discovered app and clear the old icon reference
    await db
      .update(discoveredApps)
      .set({
        status: "approved",
        onboardedAppId: appId,
        iconR2Key: null,
        updatedAt: now,
      })
      .where(eq(discoveredApps.id, data.discoveredAppId));

    // 6. Audit log
    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "app_onboarded",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "app",
      targetId: appId,
      payloadJson: JSON.stringify({
        discoveredAppId: data.discoveredAppId,
        aliases: data.aliases.length,
        hasSource,
        sourceValidated: data.sourceValidated,
      }),
      createdAt: now,
    });

    // 7. Enqueue first source fetch for active sources
    for (const srcId of activeSourceIds) {
      await env.SOURCE_FETCH_QUEUE.send({
        sourceId: srcId,
        reason: "onboarding",
      });
    }

    return { id: appId, status: "onboarded" };
  });

// ──────────────────────────────────────────────────────────
// On-demand cask token lookup
// ──────────────────────────────────────────────────────────

export const lookupCaskToken = createServerFn({ method: "GET" })
  .inputValidator(z.object({ bundleId: z.string().min(1) }))
  .handler(async ({ data: { bundleId } }) => {
    const token = await lookupCaskTokenByBundleId(env.CONFIG_KV, bundleId);
    return { caskToken: token };
  });
