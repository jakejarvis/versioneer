import { createServerFn } from "@tanstack/react-start";
import { normalizeAliasValue } from "@versioneer/core/identity";
import { lookupCaskTokenByBundleId } from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import {
  apps,
  appAliases,
  sources,
  discoveredApps,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/db";
import { aliasTypeSchema } from "@versioneer/schemas/catalog";
import {
  defaultRoleForSourceType,
  defaultRuntimeStatusForSourceType,
  sourceTypeSchema,
} from "@versioneer/schemas/sources";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { AliasConflictError, assertNoConflictingExactAlias } from "./alias-conflicts";
import { scheduleSourceFetch } from "./followup-jobs";
import { authMiddleware } from "./middleware";
import { buildSourceDerivedAliasInserts, normalizeSourceBaseUrl } from "./source-derived-aliases";

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
// Onboard from discovered app
// ──────────────────────────────────────────────────────────

const aliasInputSchema = z.object({
  aliasType: aliasTypeSchema,
  value: z.string().min(1),
});

const sourceInputSchema = z.object({
  sourceType: sourceTypeSchema,
  baseUrl: z.string().url().max(2000),
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
  sources: z.array(sourceInputSchema).optional(),
  sourceValidated: z.boolean().default(false),
  enrichmentHasReleases: z.boolean().default(false),
});

/**
 * Onboards a discovered app by committing all local catalog writes together,
 * then best-effort scheduling initial source fetches after the transaction.
 * Creates zero review-queue items.
 */
export const onboardDiscoveredApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(onboardDiscoveredAppSchema)
  .handler(async ({ data, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const appId = generateId(idPrefixes.app);
    const allSources = data.sources ?? [];

    // 0. Validate discovered app exists and hasn't been onboarded already
    const discoveredAppRow = await db
      .select()
      .from(discoveredApps)
      .where(eq(discoveredApps.id, data.discoveredAppId))
      .get();
    if (!discoveredAppRow) throw new Error("Discovered app not found");
    if (discoveredAppRow.linkedAppId) throw new Error("Discovered app already linked");

    for (const alias of data.aliases) {
      try {
        await assertNoConflictingExactAlias(db, {
          aliasType: alias.aliasType,
          value: alias.value,
        });
      } catch (error) {
        if (error instanceof AliasConflictError) {
          throw new Error(
            `Conflicting ${alias.aliasType.replaceAll("_", " ")} already belongs to app ${error.appId}`,
            { cause: error },
          );
        }
        throw error;
      }
    }

    for (const src of allSources) {
      if (src.sourceType !== "sparkle") continue;
      try {
        await assertNoConflictingExactAlias(db, {
          aliasType: "sparkle_feed",
          value: src.baseUrl,
        });
      } catch (error) {
        if (error instanceof AliasConflictError) {
          throw new Error(`Conflicting sparkle feed already belongs to app ${error.appId}`, {
            cause: error,
          });
        }
        throw error;
      }
    }

    const catalogIconR2Key = discoveredAppRow.iconR2Key;
    const appStatus = data.sourceValidated ? "public" : "draft";

    // Build all writes up-front, then execute atomically via db.batch().
    // D1 does not support BEGIN/COMMIT as prepared statements, so
    // db.transaction() cannot be used.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const writes: any[] = [];

    writes.push(
      db.insert(apps).values({
        id: appId,
        slug: data.app.slug,
        canonicalName: data.app.canonicalName,
        vendorName: data.app.vendorName ?? null,
        homepageUrl: data.app.homepageUrl ?? null,
        notes: data.app.notes ?? null,
        iconR2Key: catalogIconR2Key,
        status: appStatus,
        publicTrackedAt: appStatus === "public" ? now : null,
        createdAt: now,
        updatedAt: now,
      }),
    );

    for (const alias of data.aliases) {
      const normalizedValue = normalizeAliasValue(alias.aliasType, alias.value);
      writes.push(
        db.insert(appAliases).values({
          id: generateId(idPrefixes.alias),
          appId,
          aliasType: alias.aliasType,
          value: alias.value,
          normalizedValue,
          isExact: true,
          priority: 0,
          confidenceWeight: 100,
          source: "onboarding",
          isActive: true,
          createdAt: now,
        }),
      );
    }

    const sourceIds: string[] = [];
    for (let i = 0; i < allSources.length; i++) {
      const src = allSources[i]!;
      const normalizedBaseUrl = normalizeSourceBaseUrl(src.sourceType, src.baseUrl);
      const sourceId = generateId(idPrefixes.source);
      const isPrimary = i === 0;
      const defaultRole = defaultRoleForSourceType(src.sourceType);
      const role = isPrimary
        ? defaultRole
        : defaultRole === "authority"
          ? "corroborating"
          : defaultRole;
      const runtimeStatus = defaultRuntimeStatusForSourceType(src.sourceType);

      writes.push(
        db.insert(sources).values({
          id: sourceId,
          appId,
          sourceType: src.sourceType,
          label: src.label ?? null,
          baseUrl: normalizedBaseUrl,
          configJson: null,
          parserKey: src.parserKey,
          channel: null,
          pollIntervalMinutes: src.pollIntervalMinutes,
          reviewStatus: "approved",
          role,
          ordinal: i,
          status: runtimeStatus,
          approvedAt: now,
          reviewedAt: now,
          reviewedBy: context.user.email,
          createdAt: now,
          updatedAt: now,
        }),
      );

      writes.push(
        ...buildSourceDerivedAliasInserts(db, {
          appId,
          sourceId,
          sourceType: src.sourceType,
          baseUrl: normalizedBaseUrl,
          now,
        }),
      );

      sourceIds.push(sourceId);
    }

    writes.push(
      db
        .update(discoveredApps)
        .set({
          status: "linked",
          linkedAppId: appId,
          primarySuggestionId: null,
          updatedAt: now,
        })
        .where(eq(discoveredApps.id, data.discoveredAppId)),
    );

    writes.push(
      db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        eventType: "app_onboarded",
        actorType: "admin",
        actorId: context.user.email,
        targetType: "app",
        targetId: appId,
        payloadJson: JSON.stringify({
          discoveredAppId: data.discoveredAppId,
          aliases: data.aliases.length,
          sources: sourceIds.length,
          sourceValidated: data.sourceValidated,
          status: appStatus,
        }),
        createdAt: now,
      }),
    );

    await db.batch(writes as [(typeof writes)[0], ...typeof writes]);

    for (const sourceId of sourceIds) {
      await scheduleSourceFetch({ db, sourceId, reason: "onboarding", force: true });
    }

    return { id: appId, status: appStatus };
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
