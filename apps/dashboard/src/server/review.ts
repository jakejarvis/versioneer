import { createServerFn } from "@tanstack/react-start";
import { normalizeAliasValue } from "@versioneer/core/identity";
import { createDb } from "@versioneer/db";
import {
  apps,
  appAliases,
  auditLog,
  catalogSuggestions,
  generateId,
  idPrefixes,
  releases,
  sources,
  suggestionEvidence,
  trustAssertions,
} from "@versioneer/db";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  defaultLabelForSourceType,
  defaultParserKeyForSourceType,
  defaultRoleForSourceType,
  defaultRuntimeStatusForSourceType,
} from "@/lib/source-types";

import { assertNoConflictingExactAlias } from "./alias-conflicts";
import { loadAppsByIds, loadSourcesByIds, toAppSummary, toSourceSummary } from "./entity-summaries";
import { scheduleRecomputeLatest, scheduleSourceFetch } from "./followup-jobs";
import { authMiddleware } from "./middleware";
import { normalizeSourceBaseUrl, syncSourceDerivedAliases } from "./source-derived-aliases";

type Db = ReturnType<typeof createDb>;
type SuggestionRow = typeof catalogSuggestions.$inferSelect;
type SourceRow = typeof sources.$inferSelect;

const suggestionStatusSchema = z.enum(["pending", "approved", "rejected", "superseded"]);
const suggestionQueueTypeSchema = z.enum([
  "new_app",
  "new_source",
  "metadata_change",
  "authority_handoff",
  "merge_proposal",
  "release_discrepancy",
]);

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

const listSuggestionsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
  status: suggestionStatusSchema.default("pending"),
  queueType: suggestionQueueTypeSchema.optional(),
  sortBy: z.string().optional(),
  sortDir: sortDirectionSchema,
});

function parseJson<T>(value: string | null | undefined): T | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

async function ensureAlias(params: {
  db: Db;
  appId: string;
  aliasType:
    | "bundle_id"
    | "name"
    | "team_id"
    | "sparkle_feed"
    | "homepage"
    | "download_pattern"
    | "github_repo"
    | "mas_app_id"
    | "homebrew_cask";
  value: string;
  source: string;
  now: string;
}): Promise<void> {
  const { db, appId, aliasType, value, source, now } = params;
  const normalizedValue = normalizeAliasValue(aliasType, value);
  await assertNoConflictingExactAlias(db, {
    aliasType,
    value,
    appId,
  });

  const existing = await db
    .select({ id: appAliases.id })
    .from(appAliases)
    .where(
      and(
        eq(appAliases.appId, appId),
        eq(appAliases.aliasType, aliasType),
        eq(appAliases.normalizedValue, normalizedValue),
      ),
    )
    .get();
  if (existing) return;

  await db.insert(appAliases).values({
    id: generateId(idPrefixes.alias),
    appId,
    aliasType,
    value,
    normalizedValue,
    isExact: true,
    priority: 0,
    confidenceWeight: 100,
    source,
    isActive: true,
    createdAt: now,
  });
}

async function ensureTrustAssertion(params: {
  db: Db;
  appId: string | null;
  sourceId: string | null;
  assertionType:
    | "sparkle_public_key"
    | "bundle_id"
    | "team_id"
    | "notarization_expectation"
    | "signature_requirement";
  value: string;
  reviewer: string;
  now: string;
}): Promise<void> {
  const { db, appId, sourceId, assertionType, value, reviewer, now } = params;

  const clauses = [
    eq(trustAssertions.assertionType, assertionType),
    eq(trustAssertions.value, value),
    appId ? eq(trustAssertions.appId, appId) : sql`${trustAssertions.appId} is null`,
    sourceId ? eq(trustAssertions.sourceId, sourceId) : sql`${trustAssertions.sourceId} is null`,
  ];
  const existing = await db
    .select({ id: trustAssertions.id })
    .from(trustAssertions)
    .where(and(...clauses))
    .get();
  if (existing) return;

  await db.insert(trustAssertions).values({
    id: generateId(idPrefixes.trustAssertion),
    appId,
    sourceId,
    assertionType,
    value,
    reviewedAt: now,
    reviewedBy: reviewer,
    createdAt: now,
  });
}

async function createFollowupSuggestion(params: {
  db: Db;
  queueType: SuggestionRow["queueType"];
  dedupeKey: string;
  title: string;
  proposedChangeJson: string;
  appId?: string | null;
  sourceId?: string | null;
  evidenceSummaryJson?: string | null;
  now: string;
}): Promise<void> {
  const existing = await params.db
    .select({ id: catalogSuggestions.id })
    .from(catalogSuggestions)
    .where(eq(catalogSuggestions.dedupeKey, params.dedupeKey))
    .get();
  if (existing) return;

  await params.db.insert(catalogSuggestions).values({
    id: generateId(idPrefixes.catalogSuggestion),
    queueType: params.queueType,
    status: "pending",
    appId: params.appId ?? null,
    sourceId: params.sourceId ?? null,
    bundleKey: null,
    dedupeKey: params.dedupeKey,
    title: params.title,
    canonicalSnapshotJson: null,
    proposedChangeJson: params.proposedChangeJson,
    evidenceSummaryJson: params.evidenceSummaryJson ?? null,
    evidenceCount: 0,
    firstSeenAt: params.now,
    lastSeenAt: params.now,
    createdAt: params.now,
    updatedAt: params.now,
  });
}

async function approveNewAppSuggestion(params: {
  db: Db;
  suggestion: SuggestionRow;
  now: string;
}): Promise<void> {
  const { db, suggestion, now } = params;
  if (!suggestion.appId) {
    throw new Error("New app suggestion is missing appId");
  }

  const payload = parseJson<{
    canonicalName?: string;
    vendorName?: string | null;
    homepageUrl?: string | null;
    bundleId?: string | null;
    teamId?: string | null;
  }>(suggestion.proposedChangeJson);

  if (payload?.bundleId) {
    await assertNoConflictingExactAlias(db, {
      aliasType: "bundle_id",
      value: payload.bundleId,
      appId: suggestion.appId,
    });
  }

  const updates: Partial<typeof apps.$inferInsert> = { updatedAt: now };
  if (payload?.canonicalName) updates.canonicalName = payload.canonicalName;
  if (payload?.vendorName !== undefined) updates.vendorName = payload.vendorName;
  if (payload?.homepageUrl !== undefined) updates.homepageUrl = payload.homepageUrl;

  await db.update(apps).set(updates).where(eq(apps.id, suggestion.appId));

  if (payload?.canonicalName) {
    await ensureAlias({
      db,
      appId: suggestion.appId,
      aliasType: "name",
      value: payload.canonicalName,
      source: "catalog-review",
      now,
    });
  }
  if (payload?.bundleId) {
    await ensureAlias({
      db,
      appId: suggestion.appId,
      aliasType: "bundle_id",
      value: payload.bundleId,
      source: "catalog-review",
      now,
    });
  }
  if (payload?.teamId) {
    await ensureAlias({
      db,
      appId: suggestion.appId,
      aliasType: "team_id",
      value: payload.teamId,
      source: "catalog-review",
      now,
    });
  }
}

async function approveNewSourceSuggestion(params: {
  db: Db;
  suggestion: SuggestionRow;
  reviewer: string;
  now: string;
}): Promise<string | null> {
  const { db, suggestion, reviewer, now } = params;
  const payload = parseJson<{
    appId?: string;
    sourceType?: SourceRow["sourceType"];
    baseUrl?: string | null;
    role?: SourceRow["role"];
    channel?: string | null;
    parserKey?: string | null;
    label?: string | null;
  }>(suggestion.proposedChangeJson);

  const appId = payload?.appId ?? suggestion.appId;
  if (!appId || !payload?.sourceType) {
    throw new Error("New source suggestion is missing required fields");
  }

  if (payload.sourceType === "sparkle" && payload.baseUrl) {
    await assertNoConflictingExactAlias(db, {
      aliasType: "sparkle_feed",
      value: payload.baseUrl,
      appId,
    });
  }

  const existingSources = await db.select().from(sources).where(eq(sources.appId, appId)).all();
  const duplicate = existingSources.find(
    (source) =>
      source.sourceType === payload.sourceType &&
      (source.baseUrl ?? null) ===
        normalizeSourceBaseUrl(payload.sourceType, payload.baseUrl ?? null),
  );

  const desiredRole = payload.role ?? defaultRoleForSourceType(payload.sourceType);
  const conflictingAuthority =
    desiredRole === "authority"
      ? existingSources.find(
          (source) =>
            source.id !== duplicate?.id &&
            source.reviewStatus === "approved" &&
            source.role === "authority" &&
            (source.channel ?? null) === (payload.channel ?? null),
        )
      : null;
  const persistedRole = conflictingAuthority ? "corroborating" : desiredRole;
  const parserKey = payload.parserKey ?? defaultParserKeyForSourceType(payload.sourceType);
  const runtimeStatus = defaultRuntimeStatusForSourceType(payload.sourceType);
  const normalizedBaseUrl = normalizeSourceBaseUrl(payload.sourceType, payload.baseUrl ?? null);

  let sourceId = duplicate?.id ?? null;
  if (duplicate) {
    await db
      .update(sources)
      .set({
        reviewStatus: "approved",
        role: persistedRole,
        status: runtimeStatus,
        label: payload.label ?? duplicate.label ?? defaultLabelForSourceType(payload.sourceType),
        parserKey,
        channel: payload.channel ?? duplicate.channel,
        updatedAt: now,
        approvedAt: now,
        reviewedAt: now,
        reviewedBy: reviewer,
      })
      .where(eq(sources.id, duplicate.id));
  } else {
    sourceId = generateId(idPrefixes.source);
    await db.insert(sources).values({
      id: sourceId,
      appId,
      sourceType: payload.sourceType,
      label: payload.label ?? defaultLabelForSourceType(payload.sourceType),
      baseUrl: normalizedBaseUrl,
      configJson: null,
      parserKey,
      channel: payload.channel ?? null,
      pollIntervalMinutes: 60,
      reviewStatus: "approved",
      role: persistedRole,
      status: runtimeStatus,
      discoveredVia: "catalog_suggestion",
      approvedAt: now,
      reviewedAt: now,
      reviewedBy: reviewer,
      createdAt: now,
      updatedAt: now,
    });
  }

  if (sourceId) {
    await syncSourceDerivedAliases({
      db,
      appId,
      sourceId,
      sourceType: payload.sourceType,
      baseUrl: normalizedBaseUrl,
      now,
    });
  }

  if (sourceId && payload.sourceType === "sparkle") {
    const evidenceRows = await db
      .select()
      .from(suggestionEvidence)
      .where(eq(suggestionEvidence.suggestionId, suggestion.id))
      .all();

    for (const evidence of evidenceRows) {
      const parsed = parseJson<{ sparklePublicKey?: string | null }>(evidence.payloadJson);
      if (parsed?.sparklePublicKey) {
        await ensureTrustAssertion({
          db,
          appId,
          sourceId,
          assertionType: "sparkle_public_key",
          value: parsed.sparklePublicKey,
          reviewer,
          now,
        });
      }
    }
  }

  if (conflictingAuthority && sourceId) {
    await createFollowupSuggestion({
      db,
      queueType: "authority_handoff",
      dedupeKey: `authority_handoff:${appId}:${payload.channel ?? "stable"}:${conflictingAuthority.id}:${sourceId}`,
      title: `Review authority handoff for ${payload.channel ?? "stable"} channel`,
      proposedChangeJson: JSON.stringify({
        appId,
        channel: payload.channel ?? null,
        fromSourceId: conflictingAuthority.id,
        toSourceId: sourceId,
      }),
      appId,
      sourceId,
      evidenceSummaryJson: JSON.stringify({
        conflictingAuthorityId: conflictingAuthority.id,
        newSourceId: sourceId,
      }),
      now,
    });
  }

  if (sourceId && runtimeStatus === "active") {
    await scheduleSourceFetch({
      db,
      sourceId,
      reason: "catalog-review",
      force: true,
    });
  }

  return sourceId;
}

async function approveMetadataSuggestion(params: {
  db: Db;
  suggestion: SuggestionRow;
  reviewer: string;
  now: string;
}): Promise<void> {
  const { db, suggestion, reviewer, now } = params;
  const payload = parseJson<
    | {
        changeType: "alias";
        appId?: string;
        aliasType: Parameters<typeof ensureAlias>[0]["aliasType"];
        value: string;
      }
    | {
        changeType: "app_fields";
        appId?: string;
        canonicalName?: string;
        vendorName?: string | null;
        homepageUrl?: string | null;
      }
    | {
        changeType: "trust_assertion";
        appId?: string | null;
        sourceId?: string | null;
        assertionType: Parameters<typeof ensureTrustAssertion>[0]["assertionType"];
        value: string;
      }
  >(suggestion.proposedChangeJson);

  if (!payload) return;

  if (payload.changeType === "alias") {
    const appId = payload.appId ?? suggestion.appId;
    if (!appId) throw new Error("Alias suggestion is missing appId");
    await ensureAlias({
      db,
      appId,
      aliasType: payload.aliasType,
      value: payload.value,
      source: "catalog-review",
      now,
    });
    return;
  }

  if (payload.changeType === "app_fields") {
    const appId = payload.appId ?? suggestion.appId;
    if (!appId) throw new Error("Metadata suggestion is missing appId");
    await db
      .update(apps)
      .set({
        canonicalName: payload.canonicalName,
        vendorName: payload.vendorName,
        homepageUrl: payload.homepageUrl,
        updatedAt: now,
      })
      .where(eq(apps.id, appId));
    return;
  }

  if (payload.changeType === "trust_assertion") {
    await ensureTrustAssertion({
      db,
      appId: payload.appId ?? suggestion.appId ?? null,
      sourceId: payload.sourceId ?? suggestion.sourceId ?? null,
      assertionType: payload.assertionType,
      value: payload.value,
      reviewer,
      now,
    });
  }
}

async function approveAuthorityHandoffSuggestion(params: {
  db: Db;
  suggestion: SuggestionRow;
  reviewer: string;
  now: string;
}): Promise<void> {
  const { db, suggestion, reviewer, now } = params;
  const payload = parseJson<{
    fromSourceId?: string;
    toSourceId?: string;
  }>(suggestion.proposedChangeJson);

  if (!payload?.fromSourceId || !payload.toSourceId) {
    throw new Error("Authority handoff suggestion is missing source ids");
  }

  await db
    .update(sources)
    .set({ role: "corroborating", reviewedAt: now, reviewedBy: reviewer, updatedAt: now })
    .where(eq(sources.id, payload.fromSourceId));

  await db
    .update(sources)
    .set({
      role: "authority",
      reviewStatus: "approved",
      status: "active",
      approvedAt: now,
      reviewedAt: now,
      reviewedBy: reviewer,
      updatedAt: now,
    })
    .where(eq(sources.id, payload.toSourceId));

  await scheduleSourceFetch({
    db,
    sourceId: payload.toSourceId,
    reason: "authority-handoff",
    force: true,
  });
}

async function approveMergeSuggestion(params: {
  db: Db;
  suggestion: SuggestionRow;
  now: string;
}): Promise<void> {
  const payload = parseJson<{ fromAppId?: string; toAppId?: string }>(
    params.suggestion.proposedChangeJson,
  );
  const fromAppId = payload?.fromAppId ?? params.suggestion.appId;
  const toAppId = payload?.toAppId;
  if (!fromAppId || !toAppId) {
    throw new Error("Merge proposal is missing app ids");
  }

  await params.db
    .update(apps)
    .set({ status: "merged", mergedIntoAppId: toAppId, updatedAt: params.now })
    .where(eq(apps.id, fromAppId));
}

async function approveReleaseDiscrepancySuggestion(params: {
  db: Db;
  suggestion: SuggestionRow;
  reviewer: string;
  now: string;
}): Promise<void> {
  const payload = parseJson<{
    appId?: string;
    releaseId?: string;
    sourceId?: string | null;
    issue?: string;
  }>(params.suggestion.proposedChangeJson);
  const releaseId = payload?.releaseId;
  if (!releaseId) {
    throw new Error("Release discrepancy suggestion is missing releaseId");
  }

  const release = await params.db
    .select({
      id: releases.id,
      appId: releases.appId,
      channel: releases.channel,
      status: releases.status,
      publishedBySourceId: releases.publishedBySourceId,
    })
    .from(releases)
    .where(eq(releases.id, releaseId))
    .get();
  if (!release) {
    throw new Error("Release not found");
  }

  if (release.status !== "draft") {
    await params.db
      .update(releases)
      .set({ status: "draft", updatedAt: params.now })
      .where(eq(releases.id, release.id));
  }

  await params.db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "release_discrepancy_approved",
    actorType: "admin",
    actorId: params.reviewer,
    targetType: "release",
    targetId: release.id,
    payloadJson: JSON.stringify({
      appId: release.appId,
      sourceId: payload?.sourceId ?? release.publishedBySourceId ?? null,
      issue: payload?.issue ?? null,
      action: "quarantine_release",
    }),
    createdAt: params.now,
  });

  await scheduleRecomputeLatest({
    db: params.db,
    appId: release.appId,
    channel: release.channel,
  });

  const sourceId = payload?.sourceId ?? release.publishedBySourceId ?? null;
  if (sourceId) {
    await scheduleSourceFetch({
      db: params.db,
      sourceId,
      reason: "release-discrepancy",
      force: true,
    });
  }
}

async function applySuggestionApproval(params: {
  db: Db;
  suggestion: SuggestionRow;
  reviewer: string;
  now: string;
}): Promise<void> {
  switch (params.suggestion.queueType) {
    case "new_app":
      await approveNewAppSuggestion(params);
      return;
    case "new_source":
      await approveNewSourceSuggestion(params);
      return;
    case "metadata_change":
      await approveMetadataSuggestion(params);
      return;
    case "authority_handoff":
      await approveAuthorityHandoffSuggestion(params);
      return;
    case "merge_proposal":
      await approveMergeSuggestion(params);
      return;
    case "release_discrepancy":
      await approveReleaseDiscrepancySuggestion(params);
      return;
  }
}

export const listCatalogSuggestions = createServerFn({ method: "GET" })
  .inputValidator(listSuggestionsSchema)
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const conditions = [eq(catalogSuggestions.status, data.status)];
    if (data.queueType) {
      conditions.push(eq(catalogSuggestions.queueType, data.queueType));
    }
    const where = and(...conditions);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(catalogSuggestions)
      .where(where);
    const sortColumns = {
      firstSeenAt: catalogSuggestions.firstSeenAt,
      lastSeenAt: catalogSuggestions.lastSeenAt,
      evidenceCount: catalogSuggestions.evidenceCount,
      createdAt: catalogSuggestions.createdAt,
    } as const;
    const direction = data.sortDir === "desc" ? desc : asc;
    const sortCol = data.sortBy ? sortColumns[data.sortBy as keyof typeof sortColumns] : null;
    const orderBy = sortCol
      ? [direction(sortCol), asc(catalogSuggestions.createdAt)]
      : [asc(catalogSuggestions.firstSeenAt), asc(catalogSuggestions.createdAt)];

    const items = await db
      .select()
      .from(catalogSuggestions)
      .where(where)
      .orderBy(...orderBy)
      .limit(data.limit)
      .offset(data.offset);

    const [appMap, sourceMap] = await Promise.all([
      loadAppsByIds(
        db,
        items.map((item) => item.appId),
      ),
      loadSourcesByIds(
        db,
        items.map((item) => item.sourceId),
      ),
    ]);
    const sourceAppMap = await loadAppsByIds(
      db,
      [...sourceMap.values()].map((source) => source.appId),
    );

    return {
      items: items.map((item) => {
        const source = item.sourceId ? (sourceMap.get(item.sourceId) ?? null) : null;
        return Object.assign({}, item, {
          app: item.appId
            ? appMap.get(item.appId)
              ? toAppSummary(appMap.get(item.appId)!)
              : null
            : null,
          source:
            source && source.appId
              ? toSourceSummary(source, sourceAppMap.get(source.appId) ?? null)
              : null,
        });
      }),
      total: countResult?.count ?? 0,
      limit: data.limit,
      offset: data.offset,
    };
  });

export const getCatalogSuggestion = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const suggestion = await db
      .select()
      .from(catalogSuggestions)
      .where(eq(catalogSuggestions.id, id))
      .get();
    if (!suggestion) throw new Error("Not found");

    const evidence = await db
      .select()
      .from(suggestionEvidence)
      .where(eq(suggestionEvidence.suggestionId, id))
      .orderBy(desc(suggestionEvidence.observedAt), desc(suggestionEvidence.createdAt))
      .all();

    const [appMap, sourceMap] = await Promise.all([
      loadAppsByIds(db, [suggestion.appId]),
      loadSourcesByIds(db, [suggestion.sourceId]),
    ]);
    const source = suggestion.sourceId ? (sourceMap.get(suggestion.sourceId) ?? null) : null;
    const sourceAppMap = await loadAppsByIds(db, source ? [source.appId] : []);

    return {
      ...suggestion,
      app: suggestion.appId
        ? appMap.get(suggestion.appId)
          ? toAppSummary(appMap.get(suggestion.appId)!)
          : null
        : null,
      source:
        source && source.appId
          ? toSourceSummary(source, sourceAppMap.get(source.appId) ?? null)
          : null,
      evidence,
    };
  });

export const approveCatalogSuggestion = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id }, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const suggestion = await db
      .select()
      .from(catalogSuggestions)
      .where(eq(catalogSuggestions.id, id))
      .get();
    if (!suggestion) throw new Error("Not found");
    if (suggestion.status !== "pending") {
      return { status: suggestion.status };
    }

    await applySuggestionApproval({
      db,
      suggestion,
      reviewer: context.user.email,
      now,
    });

    await db
      .update(catalogSuggestions)
      .set({
        status: "approved",
        reviewedAt: now,
        reviewedBy: context.user.email,
        updatedAt: now,
      })
      .where(eq(catalogSuggestions.id, id));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "catalog_suggestion_approved",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "catalog_suggestion",
      targetId: id,
      payloadJson: JSON.stringify({
        queueType: suggestion.queueType,
        appId: suggestion.appId,
        sourceId: suggestion.sourceId,
      }),
      createdAt: now,
    });

    return { status: "approved" };
  });

export const rejectCatalogSuggestion = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id }, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const suggestion = await db
      .select()
      .from(catalogSuggestions)
      .where(eq(catalogSuggestions.id, id))
      .get();
    if (!suggestion) throw new Error("Not found");
    if (suggestion.status !== "pending") {
      return { status: suggestion.status };
    }

    await db
      .update(catalogSuggestions)
      .set({
        status: "rejected",
        reviewedAt: now,
        reviewedBy: context.user.email,
        updatedAt: now,
      })
      .where(eq(catalogSuggestions.id, id));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "catalog_suggestion_rejected",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "catalog_suggestion",
      targetId: id,
      payloadJson: JSON.stringify({
        queueType: suggestion.queueType,
        appId: suggestion.appId,
        sourceId: suggestion.sourceId,
      }),
      createdAt: now,
    });

    return { status: "rejected" };
  });
