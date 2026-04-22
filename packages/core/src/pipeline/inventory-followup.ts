import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { createDb } from "@versioneer/db";
import {
  appAliases,
  apps,
  catalogSuggestions,
  discoveredApps,
  generateId,
  idPrefixes,
  sources,
  suggestionEvidence,
  trustAssertions,
} from "@versioneer/db";
import type { AliasType } from "@versioneer/schemas/catalog";
import type { SourceRole, SourceType } from "@versioneer/schemas/sources";
import {
  defaultParserKeyForSourceType,
  defaultRoleForSourceType,
} from "@versioneer/schemas/sources";

import { deleteInventoryMatchSnapshot } from "../cache";
import { normalizeAliasValue } from "../identity";
import { normalizeBaseUrl, resolveSourceUrl } from "../sources/registry";

const INVENTORY_FOLLOWUP_PAYLOAD_VERSION = 1;
const D1_PARAM_LIMIT = 100;
const MAX_ICON_BYTES = 512 * 1024;

type Db = ReturnType<typeof createDb>;

const nullableStringSchema = z.string().nullable().optional();

export const inventoryFollowupQueueMessageSchema = z
  .object({
    jobId: z.string().min(1),
  })
  .strict();

export type InventoryFollowupQueueMessage = z.infer<typeof inventoryFollowupQueueMessageSchema>;

export const inventoryFollowupWorkflowPayloadSchema = z
  .object({
    jobId: z.string().min(1),
  })
  .strict();

export type InventoryFollowupWorkflowPayload = z.infer<
  typeof inventoryFollowupWorkflowPayloadSchema
>;

const discoveredIconCandidateSchema = z
  .object({
    discoveredAppId: z.string().min(1),
    lookupKey: z.string().min(1),
    iconBase64: z.string().min(1).max(500_000),
  })
  .strict();

const matchedAppCandidateSchema = z
  .object({
    appId: z.string().min(1),
    lookupKey: z.string().min(1),
    createSuggestions: z.boolean(),
    iconBase64: z.string().min(1).max(500_000).nullable().optional(),
    bundleId: nullableStringSchema,
    teamId: nullableStringSchema,
    sparkleFeedUrl: nullableStringSchema,
    sparklePublicKey: nullableStringSchema,
    isMasApp: z.boolean().nullable().optional(),
    masAppId: nullableStringSchema,
    electronUpdateProvider: nullableStringSchema,
    electronUpdateUrl: nullableStringSchema,
    homebrewCaskToken: nullableStringSchema,
  })
  .strict();

export const inventoryFollowupPayloadSchema = z
  .object({
    version: z.literal(INVENTORY_FOLLOWUP_PAYLOAD_VERSION),
    processedAt: z.string().min(1),
    discoveredIconCandidates: z.array(discoveredIconCandidateSchema),
    matchedAppCandidates: z.array(matchedAppCandidateSchema),
  })
  .strict();

export type InventoryFollowupPayload = z.infer<typeof inventoryFollowupPayloadSchema>;
export type InventoryFollowupDiscoveredIconCandidate = z.infer<
  typeof discoveredIconCandidateSchema
>;
export type InventoryFollowupMatchedAppCandidate = z.infer<typeof matchedAppCandidateSchema>;

type InventoryFollowupAppRow = Pick<
  typeof apps.$inferSelect,
  "id" | "slug" | "canonicalName" | "vendorName" | "homepageUrl" | "status" | "iconR2Key"
>;

export interface InventoryFollowupStepResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface InventoryCatalogIconResult extends InventoryFollowupStepResult {
  changed: number;
}

export function parseInventoryFollowupPayload(value: unknown): InventoryFollowupPayload {
  return inventoryFollowupPayloadSchema.parse(value);
}

export function inventoryFollowupPayloadR2Key(jobId: string, date = new Date()): string {
  const yyyy = date.getUTCFullYear();
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `inventory-followups/${yyyy}/${mm}/${dd}/${jobId}.json`;
}

export async function storeClientIcon(
  bucket: R2Bucket,
  iconBase64: string,
): Promise<string | null> {
  try {
    const binaryString = atob(iconBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)!;
    }
    const body = bytes.buffer;

    if (body.byteLength > MAX_ICON_BYTES) return null;

    const contentDigest = await crypto.subtle.digest("SHA-256", body);
    const contentHash = Array.from(new Uint8Array(contentDigest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);

    const r2Key = `icons/${contentHash}.png`;

    await bucket.put(r2Key, body, {
      httpMetadata: {
        contentType: "image/png",
        cacheControl: "public, max-age=31536000, immutable",
      },
    });

    return r2Key;
  } catch {
    return null;
  }
}

function uniqueStrings(values: Iterable<string | null | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => Boolean(value)))];
}

function chunkStrings(values: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

export async function loadInventoryFollowupAppsByIds(
  db: Db,
  appIds: string[],
): Promise<InventoryFollowupAppRow[]> {
  const rows: InventoryFollowupAppRow[] = [];
  for (const appChunk of chunkStrings(uniqueStrings(appIds), Math.max(1, D1_PARAM_LIMIT))) {
    rows.push(
      ...(await db
        .select({
          id: apps.id,
          slug: apps.slug,
          canonicalName: apps.canonicalName,
          vendorName: apps.vendorName,
          homepageUrl: apps.homepageUrl,
          status: apps.status,
          iconR2Key: apps.iconR2Key,
        })
        .from(apps)
        .where(inArray(apps.id, appChunk))
        .all()),
    );
  }
  return rows;
}

export async function storeDiscoveredInventoryIcons(params: {
  db: Db;
  assetsBucket: R2Bucket;
  candidates: InventoryFollowupDiscoveredIconCandidate[];
}): Promise<InventoryFollowupStepResult> {
  let succeeded = 0;

  for (const candidate of params.candidates) {
    const iconKey = await storeClientIcon(params.assetsBucket, candidate.iconBase64);
    if (iconKey) {
      await params.db
        .update(discoveredApps)
        .set({ iconR2Key: iconKey })
        .where(
          and(eq(discoveredApps.id, candidate.discoveredAppId), isNull(discoveredApps.iconR2Key)),
        );
    }
    succeeded++;
  }

  return { attempted: params.candidates.length, succeeded, failed: 0 };
}

export async function storeCatalogInventoryIcons(params: {
  db: Db;
  assetsBucket: R2Bucket;
  cacheKv: KVNamespace;
  candidates: InventoryFollowupMatchedAppCandidate[];
  now: string;
}): Promise<InventoryCatalogIconResult> {
  let succeeded = 0;
  let changed = 0;
  const appRows = await loadInventoryFollowupAppsByIds(
    params.db,
    params.candidates.map((candidate) => candidate.appId),
  );
  const appById = new Map(appRows.map((row) => [row.id, row] as const));

  for (const candidate of params.candidates) {
    const appRow = appById.get(candidate.appId);
    if (!appRow || appRow.iconR2Key || !candidate.iconBase64) {
      succeeded++;
      continue;
    }

    const iconKey = await storeClientIcon(params.assetsBucket, candidate.iconBase64);
    if (iconKey) {
      await params.db
        .update(apps)
        .set({ iconR2Key: iconKey, updatedAt: params.now })
        .where(and(eq(apps.id, appRow.id), isNull(apps.iconR2Key)));
      appById.set(appRow.id, { ...appRow, iconR2Key: iconKey });
      changed++;
    }
    succeeded++;
  }

  if (changed > 0) {
    await deleteInventoryMatchSnapshot(params.cacheKv);
  }

  return { attempted: params.candidates.length, succeeded, failed: 0, changed };
}

async function upsertSuggestion(params: {
  db: Db;
  queueType:
    | "new_app"
    | "new_source"
    | "metadata_change"
    | "authority_handoff"
    | "merge_proposal"
    | "release_discrepancy";
  dedupeKey: string;
  title: string;
  proposedChangeJson: string;
  canonicalSnapshotJson?: string | null;
  appId?: string | null;
  sourceId?: string | null;
  bundleKey?: string | null;
  evidenceType: "scan" | "crawl" | "fetch_parse" | "install_verify" | "homebrew" | "manual";
  evidenceFingerprint: string;
  evidencePayloadJson: string;
  now: string;
}): Promise<void> {
  const existingSuggestion = await params.db
    .select({ id: catalogSuggestions.id })
    .from(catalogSuggestions)
    .where(eq(catalogSuggestions.dedupeKey, params.dedupeKey))
    .get();
  const existingEvidence = existingSuggestion
    ? await params.db
        .select({ id: suggestionEvidence.id })
        .from(suggestionEvidence)
        .where(
          and(
            eq(suggestionEvidence.suggestionId, existingSuggestion.id),
            eq(suggestionEvidence.fingerprint, params.evidenceFingerprint),
          ),
        )
        .get()
    : null;

  await params.db
    .insert(catalogSuggestions)
    .values({
      id: generateId(idPrefixes.catalogSuggestion),
      queueType: params.queueType,
      status: "pending",
      appId: params.appId ?? null,
      sourceId: params.sourceId ?? null,
      bundleKey: params.bundleKey ?? null,
      dedupeKey: params.dedupeKey,
      title: params.title,
      canonicalSnapshotJson: params.canonicalSnapshotJson ?? null,
      proposedChangeJson: params.proposedChangeJson,
      evidenceSummaryJson: params.evidencePayloadJson,
      evidenceCount: 1,
      firstSeenAt: params.now,
      lastSeenAt: params.now,
      createdAt: params.now,
      updatedAt: params.now,
    })
    .onConflictDoUpdate({
      target: catalogSuggestions.dedupeKey,
      set: {
        appId: sql`coalesce(${params.appId ?? null}, ${catalogSuggestions.appId})`,
        sourceId: sql`coalesce(${params.sourceId ?? null}, ${catalogSuggestions.sourceId})`,
        title: params.title,
        canonicalSnapshotJson: sql`coalesce(${params.canonicalSnapshotJson ?? null}, ${catalogSuggestions.canonicalSnapshotJson})`,
        proposedChangeJson: params.proposedChangeJson,
        evidenceSummaryJson: params.evidencePayloadJson,
        evidenceCount: existingEvidence
          ? catalogSuggestions.evidenceCount
          : sql`${catalogSuggestions.evidenceCount} + 1`,
        lastSeenAt: params.now,
        updatedAt: params.now,
      },
    });

  const suggestion = await params.db
    .select({ id: catalogSuggestions.id })
    .from(catalogSuggestions)
    .where(eq(catalogSuggestions.dedupeKey, params.dedupeKey))
    .get();
  if (!suggestion) return;

  await params.db
    .insert(suggestionEvidence)
    .values({
      id: generateId(idPrefixes.suggestionEvidence),
      suggestionId: suggestion.id,
      appId: params.appId ?? null,
      sourceId: params.sourceId ?? null,
      evidenceType: params.evidenceType,
      fingerprint: params.evidenceFingerprint,
      payloadJson: params.evidencePayloadJson,
      observedAt: params.now,
      createdAt: params.now,
    })
    .onConflictDoNothing();
}

async function findExistingAlias(params: {
  db: Db;
  appId: string;
  aliasType: AliasType;
  value: string;
}) {
  return params.db
    .select({ id: appAliases.id })
    .from(appAliases)
    .where(
      and(
        eq(appAliases.appId, params.appId),
        eq(appAliases.aliasType, params.aliasType),
        eq(appAliases.normalizedValue, normalizeAliasValue(params.aliasType, params.value)),
      ),
    )
    .get();
}

async function findExistingSource(params: {
  db: Db;
  appId: string;
  sourceType: SourceType;
  baseUrl: string;
}) {
  const normalizedUrl = normalizeBaseUrl(params.sourceType, params.baseUrl);
  return params.db
    .select({
      id: sources.id,
      sourceType: sources.sourceType,
      baseUrl: sources.baseUrl,
      role: sources.role,
      reviewStatus: sources.reviewStatus,
      channel: sources.channel,
    })
    .from(sources)
    .where(
      and(
        eq(sources.appId, params.appId),
        eq(sources.sourceType, params.sourceType),
        eq(sources.baseUrl, normalizedUrl),
      ),
    )
    .get();
}

async function createSourceSuggestion(params: {
  db: Db;
  appId: string;
  appName: string;
  lookupKey: string;
  sourceType: SourceType;
  baseUrl: string;
  role?: SourceRole;
  title?: string;
  canonicalSnapshotJson?: string | null;
  evidenceType: "scan" | "crawl" | "fetch_parse" | "install_verify" | "homebrew" | "manual";
  evidenceFingerprint: string;
  evidencePayloadJson: string;
  now: string;
}): Promise<void> {
  const existing = await findExistingSource({
    db: params.db,
    appId: params.appId,
    sourceType: params.sourceType,
    baseUrl: params.baseUrl,
  });
  if (existing) return;

  const normalizedUrl = normalizeBaseUrl(params.sourceType, params.baseUrl);
  await upsertSuggestion({
    db: params.db,
    queueType: "new_source",
    dedupeKey: `source:${params.appId}:${params.sourceType}:${normalizedUrl}`,
    title:
      params.title ??
      `Review ${params.sourceType.replaceAll("_", " ")} source for ${params.appName}`,
    canonicalSnapshotJson: params.canonicalSnapshotJson ?? null,
    proposedChangeJson: JSON.stringify({
      appId: params.appId,
      sourceType: params.sourceType,
      baseUrl: normalizedUrl,
      role: params.role ?? defaultRoleForSourceType(params.sourceType),
      parserKey: defaultParserKeyForSourceType(params.sourceType),
    }),
    appId: params.appId,
    bundleKey: params.lookupKey,
    evidenceType: params.evidenceType,
    evidenceFingerprint: params.evidenceFingerprint,
    evidencePayloadJson: params.evidencePayloadJson,
    now: params.now,
  });
}

async function createAliasSuggestion(params: {
  db: Db;
  appId: string;
  appName: string;
  lookupKey: string;
  aliasType: AliasType;
  value: string;
  canonicalSnapshotJson?: string | null;
  evidenceType: "scan" | "crawl" | "fetch_parse" | "install_verify" | "homebrew" | "manual";
  evidenceFingerprint: string;
  evidencePayloadJson: string;
  now: string;
}): Promise<void> {
  const existing = await findExistingAlias({
    db: params.db,
    appId: params.appId,
    aliasType: params.aliasType,
    value: params.value,
  });
  if (existing) return;

  await upsertSuggestion({
    db: params.db,
    queueType: "metadata_change",
    dedupeKey: `alias:${params.appId}:${params.aliasType}:${normalizeAliasValue(params.aliasType, params.value)}`,
    title: `Review ${params.aliasType.replaceAll("_", " ")} for ${params.appName}`,
    canonicalSnapshotJson: params.canonicalSnapshotJson ?? null,
    proposedChangeJson: JSON.stringify({
      changeType: "alias",
      appId: params.appId,
      aliasType: params.aliasType,
      value: params.value,
    }),
    appId: params.appId,
    bundleKey: params.lookupKey,
    evidenceType: params.evidenceType,
    evidenceFingerprint: params.evidenceFingerprint,
    evidencePayloadJson: params.evidencePayloadJson,
    now: params.now,
  });
}

async function createTrustAssertionSuggestion(params: {
  db: Db;
  appId: string;
  appName: string;
  lookupKey: string;
  sourceId?: string | null;
  assertionType:
    | "sparkle_public_key"
    | "bundle_id"
    | "team_id"
    | "notarization_expectation"
    | "signature_requirement";
  value: string;
  canonicalSnapshotJson?: string | null;
  evidenceFingerprint: string;
  evidencePayloadJson: string;
  now: string;
}): Promise<void> {
  const existingAssertion = await params.db
    .select({ id: trustAssertions.id })
    .from(trustAssertions)
    .where(
      and(
        eq(trustAssertions.appId, params.appId),
        params.sourceId
          ? eq(trustAssertions.sourceId, params.sourceId)
          : sql`${trustAssertions.sourceId} is null`,
        eq(trustAssertions.assertionType, params.assertionType),
        eq(trustAssertions.value, params.value),
      ),
    )
    .get();
  if (existingAssertion) return;

  await upsertSuggestion({
    db: params.db,
    queueType: "metadata_change",
    dedupeKey: `trust:${params.appId}:${params.sourceId ?? "none"}:${params.assertionType}:${params.value}`,
    title: `Review ${params.assertionType.replaceAll("_", " ")} for ${params.appName}`,
    canonicalSnapshotJson: params.canonicalSnapshotJson ?? null,
    proposedChangeJson: JSON.stringify({
      changeType: "trust_assertion",
      appId: params.appId,
      sourceId: params.sourceId ?? null,
      assertionType: params.assertionType,
      value: params.value,
    }),
    appId: params.appId,
    sourceId: params.sourceId ?? null,
    bundleKey: params.lookupKey,
    evidenceType: "scan",
    evidenceFingerprint: params.evidenceFingerprint,
    evidencePayloadJson: params.evidencePayloadJson,
    now: params.now,
  });
}

export async function createInventoryFollowupSuggestions(params: {
  db: Db;
  candidates: InventoryFollowupMatchedAppCandidate[];
  now: string;
}): Promise<InventoryFollowupStepResult> {
  const appRows = await loadInventoryFollowupAppsByIds(
    params.db,
    params.candidates.map((candidate) => candidate.appId),
  );
  const appById = new Map(appRows.map((row) => [row.id, row] as const));
  let succeeded = 0;

  for (const candidate of params.candidates) {
    if (!candidate.createSuggestions) {
      succeeded++;
      continue;
    }

    const appRow = appById.get(candidate.appId);
    if (!appRow) {
      succeeded++;
      continue;
    }

    const canonicalSnapshotJson = JSON.stringify({
      canonicalName: appRow.canonicalName,
      vendorName: appRow.vendorName,
      homepageUrl: appRow.homepageUrl,
      status: appRow.status,
    });

    if (candidate.bundleId) {
      await createAliasSuggestion({
        db: params.db,
        appId: appRow.id,
        appName: appRow.canonicalName,
        lookupKey: candidate.lookupKey,
        aliasType: "bundle_id",
        value: candidate.bundleId,
        canonicalSnapshotJson,
        evidenceType: "scan",
        evidenceFingerprint: `public-bundle:${candidate.lookupKey}:${candidate.bundleId}`,
        evidencePayloadJson: JSON.stringify({ bundleId: candidate.bundleId }),
        now: params.now,
      });
    }

    if (candidate.teamId) {
      await createAliasSuggestion({
        db: params.db,
        appId: appRow.id,
        appName: appRow.canonicalName,
        lookupKey: candidate.lookupKey,
        aliasType: "team_id",
        value: candidate.teamId,
        canonicalSnapshotJson,
        evidenceType: "scan",
        evidenceFingerprint: `public-team:${candidate.lookupKey}:${candidate.teamId}`,
        evidencePayloadJson: JSON.stringify({ teamId: candidate.teamId }),
        now: params.now,
      });
    }

    if (candidate.masAppId) {
      await createAliasSuggestion({
        db: params.db,
        appId: appRow.id,
        appName: appRow.canonicalName,
        lookupKey: candidate.lookupKey,
        aliasType: "mas_app_id",
        value: candidate.masAppId,
        canonicalSnapshotJson,
        evidenceType: "scan",
        evidenceFingerprint: `public-mas-id:${candidate.lookupKey}:${candidate.masAppId}`,
        evidencePayloadJson: JSON.stringify({ masAppId: candidate.masAppId }),
        now: params.now,
      });
    }

    if (candidate.homebrewCaskToken) {
      await createAliasSuggestion({
        db: params.db,
        appId: appRow.id,
        appName: appRow.canonicalName,
        lookupKey: candidate.lookupKey,
        aliasType: "homebrew_cask",
        value: candidate.homebrewCaskToken,
        canonicalSnapshotJson,
        evidenceType: "scan",
        evidenceFingerprint: `public-homebrew:${candidate.lookupKey}:${candidate.homebrewCaskToken}`,
        evidencePayloadJson: JSON.stringify({
          homebrewCaskToken: candidate.homebrewCaskToken,
        }),
        now: params.now,
      });
    }

    if (candidate.electronUpdateUrl) {
      await createAliasSuggestion({
        db: params.db,
        appId: appRow.id,
        appName: appRow.canonicalName,
        lookupKey: candidate.lookupKey,
        aliasType: "electron_update_url",
        value: candidate.electronUpdateUrl,
        canonicalSnapshotJson,
        evidenceType: "scan",
        evidenceFingerprint: `public-electron-alias:${candidate.lookupKey}:${candidate.electronUpdateUrl}`,
        evidencePayloadJson: JSON.stringify({
          electronUpdateUrl: candidate.electronUpdateUrl,
          electronUpdateProvider: candidate.electronUpdateProvider ?? null,
        }),
        now: params.now,
      });
    }

    if (candidate.sparkleFeedUrl) {
      await createSourceSuggestion({
        db: params.db,
        appId: appRow.id,
        appName: appRow.canonicalName,
        lookupKey: candidate.lookupKey,
        sourceType: "sparkle",
        baseUrl: candidate.sparkleFeedUrl,
        canonicalSnapshotJson,
        evidenceType: "scan",
        evidenceFingerprint: `public-sparkle:${candidate.lookupKey}:${candidate.sparkleFeedUrl}`,
        evidencePayloadJson: JSON.stringify({
          sparkleFeedUrl: candidate.sparkleFeedUrl,
          sparklePublicKey: candidate.sparklePublicKey ?? null,
        }),
        now: params.now,
      });
    }

    if (candidate.electronUpdateUrl) {
      await createSourceSuggestion({
        db: params.db,
        appId: appRow.id,
        appName: appRow.canonicalName,
        lookupKey: candidate.lookupKey,
        sourceType: "electron_generic",
        baseUrl: candidate.electronUpdateUrl,
        canonicalSnapshotJson,
        evidenceType: "scan",
        evidenceFingerprint: `public-electron:${candidate.lookupKey}:${candidate.electronUpdateUrl}`,
        evidencePayloadJson: JSON.stringify({
          electronUpdateUrl: candidate.electronUpdateUrl,
          electronUpdateProvider: candidate.electronUpdateProvider ?? null,
        }),
        now: params.now,
      });
    }

    if (candidate.isMasApp && candidate.bundleId) {
      const lookupUrl = resolveSourceUrl("mac_app_store", candidate.bundleId)!;
      await createSourceSuggestion({
        db: params.db,
        appId: appRow.id,
        appName: appRow.canonicalName,
        lookupKey: candidate.lookupKey,
        sourceType: "mac_app_store",
        baseUrl: lookupUrl,
        canonicalSnapshotJson,
        evidenceType: "scan",
        evidenceFingerprint: `public-mas:${candidate.lookupKey}:${lookupUrl}`,
        evidencePayloadJson: JSON.stringify({
          bundleId: candidate.bundleId,
          lookupUrl,
        }),
        now: params.now,
      });
    }

    if (candidate.sparklePublicKey && candidate.sparkleFeedUrl) {
      const sparkleSource = await findExistingSource({
        db: params.db,
        appId: appRow.id,
        sourceType: "sparkle",
        baseUrl: candidate.sparkleFeedUrl,
      });
      if (sparkleSource) {
        await createTrustAssertionSuggestion({
          db: params.db,
          appId: appRow.id,
          appName: appRow.canonicalName,
          lookupKey: candidate.lookupKey,
          sourceId: sparkleSource.id,
          assertionType: "sparkle_public_key",
          value: candidate.sparklePublicKey,
          canonicalSnapshotJson,
          evidenceFingerprint: `public-sparkle-key:${candidate.lookupKey}:${candidate.sparklePublicKey}`,
          evidencePayloadJson: JSON.stringify({
            sparkleFeedUrl: candidate.sparkleFeedUrl,
            sparklePublicKey: candidate.sparklePublicKey,
          }),
          now: params.now,
        });
      }
    }

    succeeded++;
  }

  return { attempted: params.candidates.length, succeeded, failed: 0 };
}
