import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { normalizeAliasValue } from "@versioneer/identity";
import { lookupCaskTokenByBundleId } from "@versioneer/pipeline";
import {
  apps,
  appAliases,
  catalogSuggestions,
  discoveredApps,
  auditLog,
  generateId,
  idPrefixes,
  suggestionEvidence,
} from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { AliasConflictError, assertNoConflictingExactAlias } from "./alias-conflicts";
import { authMiddleware } from "./middleware";
import { normalizeSourceBaseUrl } from "./source-derived-aliases";

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
  sourceType: z.enum([
    "sparkle",
    "github_releases",
    "manual",
    "homebrew_cask",
    "mac_app_store",
    "electron_generic",
    "rss_feed",
    "json_feed",
  ]),
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
    const allSources = data.sources ?? (data.source ? [data.source] : []);

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
      status: "draft",
      publicTrackedAt: null,
      createdAt: now,
      updatedAt: now,
    });

    // 2. Create aliases
    for (const alias of data.aliases) {
      try {
        await assertNoConflictingExactAlias(db, {
          aliasType: alias.aliasType,
          value: alias.value,
          appId,
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

      await ensureOnboardingAlias({
        db,
        appId,
        aliasType: alias.aliasType,
        value: alias.value,
        source: "onboarding",
        now,
      });
    }

    const newAppSuggestionId = await upsertSuggestion({
      db,
      queueType: "new_app",
      dedupeKey: `onboarding:new_app:${appId}`,
      title: `Review new app draft for ${data.app.canonicalName}`,
      proposedChangeJson: JSON.stringify({
        canonicalName: data.app.canonicalName,
        vendorName: data.app.vendorName ?? null,
        homepageUrl: data.app.homepageUrl ?? null,
        bundleId: discoveredAppRow.bundleId ?? null,
        teamId: discoveredAppRow.teamId ?? null,
      }),
      canonicalSnapshotJson: JSON.stringify({
        appId,
        slug: data.app.slug,
        canonicalName: data.app.canonicalName,
      }),
      appId,
      sourceId: null,
      bundleKey: discoveredAppRow.lookupKey,
      evidenceFingerprint: `manual-onboarding:new_app:${data.discoveredAppId}`,
      evidencePayloadJson: JSON.stringify({
        discoveredAppId: data.discoveredAppId,
        appName: discoveredAppRow.appName,
        bundleId: discoveredAppRow.bundleId ?? null,
        teamId: discoveredAppRow.teamId ?? null,
        sourceValidated: data.sourceValidated,
        enrichmentHasReleases: data.enrichmentHasReleases,
      }),
      now,
    });

    // 3. Create source suggestions rather than approved live sources
    let hasSource = false;
    for (const src of allSources) {
      const normalizedBaseUrl = normalizeSourceBaseUrl(src.sourceType, src.baseUrl);
      hasSource = true;
      await upsertSuggestion({
        db,
        queueType: "new_source",
        dedupeKey: `onboarding:new_source:${appId}:${src.sourceType}:${normalizedBaseUrl}`,
        title: `Review ${src.sourceType.replaceAll("_", " ")} source for ${data.app.canonicalName}`,
        proposedChangeJson: JSON.stringify({
          appId,
          sourceType: src.sourceType,
          baseUrl: normalizedBaseUrl,
          role: defaultRoleForSourceType(src.sourceType),
          parserKey: src.parserKey,
          label: src.label ?? null,
        }),
        canonicalSnapshotJson: JSON.stringify({
          appId,
          sourceType: src.sourceType,
          baseUrl: normalizedBaseUrl,
        }),
        appId,
        sourceId: null,
        bundleKey: discoveredAppRow.lookupKey,
        evidenceFingerprint: `manual-onboarding:new_source:${data.discoveredAppId}:${src.sourceType}:${normalizedBaseUrl}`,
        evidencePayloadJson: JSON.stringify({
          discoveredAppId: data.discoveredAppId,
          sourceType: src.sourceType,
          baseUrl: normalizedBaseUrl,
          sourceValidated: data.sourceValidated,
          enrichmentHasReleases: data.enrichmentHasReleases,
          sparklePublicKey:
            src.sourceType === "sparkle" ? (discoveredAppRow.sparklePublicKey ?? null) : null,
        }),
        now,
      });
    }

    // 4. Link discovered app to the internal draft and clear the old icon reference
    await db
      .update(discoveredApps)
      .set({
        status: "linked",
        linkedAppId: appId,
        primarySuggestionId: newAppSuggestionId,
        iconR2Key: null,
        updatedAt: now,
      })
      .where(eq(discoveredApps.id, data.discoveredAppId));

    // 5. Audit log
    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "app_onboarding_submitted",
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

    return { id: appId, status: "submitted" };
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

async function ensureOnboardingAlias(params: {
  db: ReturnType<typeof createDb>;
  appId: string;
  aliasType: z.infer<typeof aliasInputSchema>["aliasType"];
  value: string;
  source: string;
  now: string;
}) {
  const normalizedValue = normalizeAliasValue(params.aliasType, params.value);
  const existing = await params.db
    .select({ id: appAliases.id })
    .from(appAliases)
    .where(
      and(
        eq(appAliases.appId, params.appId),
        eq(appAliases.aliasType, params.aliasType),
        eq(appAliases.normalizedValue, normalizedValue),
      ),
    )
    .get();
  if (existing) return;

  await params.db.insert(appAliases).values({
    id: generateId(idPrefixes.alias),
    appId: params.appId,
    aliasType: params.aliasType,
    value: params.value,
    normalizedValue,
    isExact: true,
    priority: 0,
    confidenceWeight: 100,
    source: params.source,
    isActive: true,
    createdAt: params.now,
  });
}

function defaultRoleForSourceType(sourceType: z.infer<typeof sourceInputSchema>["sourceType"]) {
  if (sourceType === "homebrew_cask") return "corroborating" as const;
  if (sourceType === "rss_feed" || sourceType === "json_feed") return "reference" as const;
  return "authority" as const;
}

async function upsertSuggestion(params: {
  db: ReturnType<typeof createDb>;
  queueType: "new_app" | "new_source" | "metadata_change";
  dedupeKey: string;
  title: string;
  proposedChangeJson: string;
  canonicalSnapshotJson: string | null;
  appId: string;
  sourceId: string | null;
  bundleKey: string | null;
  evidenceFingerprint: string;
  evidencePayloadJson: string;
  now: string;
}): Promise<string> {
  let suggestion = await params.db
    .select()
    .from(catalogSuggestions)
    .where(eq(catalogSuggestions.dedupeKey, params.dedupeKey))
    .get();

  if (!suggestion) {
    const suggestionId = generateId(idPrefixes.catalogSuggestion);
    await params.db.insert(catalogSuggestions).values({
      id: suggestionId,
      queueType: params.queueType,
      status: "pending",
      appId: params.appId,
      sourceId: params.sourceId,
      bundleKey: params.bundleKey,
      dedupeKey: params.dedupeKey,
      title: params.title,
      canonicalSnapshotJson: params.canonicalSnapshotJson,
      proposedChangeJson: params.proposedChangeJson,
      evidenceSummaryJson: params.evidencePayloadJson,
      evidenceCount: 1,
      firstSeenAt: params.now,
      lastSeenAt: params.now,
      createdAt: params.now,
      updatedAt: params.now,
    });
    suggestion = await params.db
      .select()
      .from(catalogSuggestions)
      .where(eq(catalogSuggestions.id, suggestionId))
      .get();
  } else {
    await params.db
      .update(catalogSuggestions)
      .set({
        title: params.title,
        canonicalSnapshotJson: params.canonicalSnapshotJson ?? suggestion.canonicalSnapshotJson,
        proposedChangeJson: params.proposedChangeJson,
        evidenceSummaryJson: params.evidencePayloadJson,
        evidenceCount: sql`${catalogSuggestions.evidenceCount} + 1`,
        lastSeenAt: params.now,
        updatedAt: params.now,
      })
      .where(eq(catalogSuggestions.id, suggestion.id));
  }

  if (!suggestion) {
    throw new Error("Failed to create onboarding suggestion");
  }

  const existingEvidence = await params.db
    .select({ id: suggestionEvidence.id })
    .from(suggestionEvidence)
    .where(
      and(
        eq(suggestionEvidence.suggestionId, suggestion.id),
        eq(suggestionEvidence.fingerprint, params.evidenceFingerprint),
      ),
    )
    .get();

  if (!existingEvidence) {
    await params.db.insert(suggestionEvidence).values({
      id: generateId(idPrefixes.suggestionEvidence),
      suggestionId: suggestion.id,
      appId: params.appId,
      sourceId: params.sourceId,
      evidenceType: "manual",
      fingerprint: params.evidenceFingerprint,
      payloadJson: params.evidencePayloadJson,
      observedAt: params.now,
      createdAt: params.now,
    });
  }

  return suggestion.id;
}
