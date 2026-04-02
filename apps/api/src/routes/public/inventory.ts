import { matchApp, normalizeAliasValue } from "@versioneer/core/identity";
import type { AliasRecord, TrustAssertionRecord } from "@versioneer/core/identity";
import { normalizeBaseUrl, resolveSourceUrl } from "@versioneer/core/sources";
import { inventoryCheckRequestSchema } from "@versioneer/core/validation";
import type { AppDecision } from "@versioneer/core/validation";
import { displayVersion, normalizeVersion } from "@versioneer/core/versioning";
import { createDb } from "@versioneer/db";
import {
  apps,
  appAliases,
  appLatestReleases,
  artifacts,
  catalogSuggestions,
  releases,
  sources,
  discoveredApps,
  generateId,
  idPrefixes,
  suggestionEvidence,
  trustAssertions,
} from "@versioneer/db";
import type { AliasType } from "@versioneer/schemas/catalog";
import type { SourceType, SourceRole } from "@versioneer/schemas/sources";
import {
  defaultParserKeyForSourceType,
  defaultRoleForSourceType,
} from "@versioneer/schemas/sources";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

import { isArchCompatible, isOsVersionCompatible, computeStaleSince } from "./helpers";

function computeLookupKey(appName: string, bundleId?: string | null): string {
  if (bundleId) return `bid:${bundleId.toLowerCase()}`;
  return `name:${appName
    .toLowerCase()
    .trim()
    .replace(/\.app$/, "")}`;
}

type InventoryRequestApp = z.infer<typeof inventoryCheckRequestSchema>["apps"][number];

type DiscoveryCandidate = {
  appName: string;
  bundleId?: string | null;
  teamId?: string | null;
  version?: string | null;
  sparkleFeedUrl?: string | null;
  sparklePublicKey?: string | null;
  isSparkleApp?: boolean | null;
  isMasApp?: boolean | null;
  masAppId?: string | null;
  isElectronApp?: boolean | null;
  electronUpdateProvider?: string | null;
  electronUpdateUrl?: string | null;
  codeSigningAuthority?: string | null;
  appCategory?: string | null;
  minMacOSVersion?: string | null;
  iconBase64?: string | null;
  homebrewCaskToken?: string | null;
};

type PersistedDiscovery = {
  id: string;
  iconR2Key: string | null;
};

function collectUnmatchedApps(
  installedApps: InventoryRequestApp[],
  resultByLookupKey: ReadonlyMap<string, AppDecision>,
): Map<string, DiscoveryCandidate> {
  const unmatchedByKey = new Map<string, DiscoveryCandidate>();

  for (const installedApp of installedApps) {
    const key = computeLookupKey(installedApp.appName, installedApp.bundleId);
    const result = resultByLookupKey.get(key);
    if (result?.trackingState === "public" || unmatchedByKey.has(key)) continue;

    unmatchedByKey.set(key, {
      appName: installedApp.appName,
      bundleId: installedApp.bundleId,
      teamId: installedApp.teamId,
      version: installedApp.version,
      sparkleFeedUrl: installedApp.sparkleFeedUrl,
      sparklePublicKey: installedApp.sparklePublicKey,
      isSparkleApp: installedApp.isSparkleApp,
      isMasApp: installedApp.isMasApp,
      masAppId: installedApp.masAppId,
      isElectronApp: installedApp.isElectronApp,
      electronUpdateProvider: installedApp.electronUpdateProvider,
      electronUpdateUrl: installedApp.electronUpdateUrl,
      codeSigningAuthority: installedApp.codeSigningAuthority,
      appCategory: installedApp.appCategory,
      minMacOSVersion: installedApp.minMacOSVersion,
      iconBase64: installedApp.iconBase64,
      homebrewCaskToken: installedApp.homebrewCaskToken,
    });
  }

  return unmatchedByKey;
}

async function upsertDiscoveredApps(params: {
  db: ReturnType<typeof createDb>;
  unmatchedByKey: Map<string, DiscoveryCandidate>;
  now: string;
}): Promise<Map<string, PersistedDiscovery>> {
  const { db, unmatchedByKey, now } = params;
  const persistedByKey = new Map<string, PersistedDiscovery>();
  if (unmatchedByKey.size === 0) return persistedByKey;

  // D1 limits queries to 100 bound parameters — batch the lookup keys
  const allKeys = [...unmatchedByKey.keys()];
  const D1_PARAM_LIMIT = 100;
  const firstChunk = allKeys.slice(0, D1_PARAM_LIMIT);
  const existingRows = await db
    .select({
      id: discoveredApps.id,
      lookupKey: discoveredApps.lookupKey,
      appName: discoveredApps.appName,
      bundleId: discoveredApps.bundleId,
      teamId: discoveredApps.teamId,
      sampleVersions: discoveredApps.sampleVersions,
      sparkleFeedUrl: discoveredApps.sparkleFeedUrl,
      sparklePublicKey: discoveredApps.sparklePublicKey,
      isSparkleApp: discoveredApps.isSparkleApp,
      isMasApp: discoveredApps.isMasApp,
      masAppId: discoveredApps.masAppId,
      isElectronApp: discoveredApps.isElectronApp,
      electronUpdateProvider: discoveredApps.electronUpdateProvider,
      electronUpdateUrl: discoveredApps.electronUpdateUrl,
      codeSigningAuthority: discoveredApps.codeSigningAuthority,
      appCategory: discoveredApps.appCategory,
      minMacOSVersion: discoveredApps.minMacOSVersion,
      homebrewCaskToken: discoveredApps.homebrewCaskToken,
      iconR2Key: discoveredApps.iconR2Key,
    })
    .from(discoveredApps)
    .where(inArray(discoveredApps.lookupKey, firstChunk))
    .all();
  for (let i = D1_PARAM_LIMIT; i < allKeys.length; i += D1_PARAM_LIMIT) {
    const chunk = allKeys.slice(i, i + D1_PARAM_LIMIT);
    const rows = await db
      .select({
        id: discoveredApps.id,
        lookupKey: discoveredApps.lookupKey,
        appName: discoveredApps.appName,
        bundleId: discoveredApps.bundleId,
        teamId: discoveredApps.teamId,
        sampleVersions: discoveredApps.sampleVersions,
        sparkleFeedUrl: discoveredApps.sparkleFeedUrl,
        sparklePublicKey: discoveredApps.sparklePublicKey,
        isSparkleApp: discoveredApps.isSparkleApp,
        isMasApp: discoveredApps.isMasApp,
        masAppId: discoveredApps.masAppId,
        isElectronApp: discoveredApps.isElectronApp,
        electronUpdateProvider: discoveredApps.electronUpdateProvider,
        electronUpdateUrl: discoveredApps.electronUpdateUrl,
        codeSigningAuthority: discoveredApps.codeSigningAuthority,
        appCategory: discoveredApps.appCategory,
        minMacOSVersion: discoveredApps.minMacOSVersion,
        homebrewCaskToken: discoveredApps.homebrewCaskToken,
        iconR2Key: discoveredApps.iconR2Key,
      })
      .from(discoveredApps)
      .where(inArray(discoveredApps.lookupKey, chunk))
      .all();
    existingRows.push(...rows);
  }

  const existingByKey = new Map(existingRows.map((row) => [row.lookupKey, row] as const));

  for (const [key, app] of unmatchedByKey) {
    const existing = existingByKey.get(key);

    if (existing) {
      let sampleVersions: string[] = [];
      try {
        sampleVersions = existing.sampleVersions ? JSON.parse(existing.sampleVersions) : [];
      } catch {
        // ignore malformed JSON
      }
      if (app.version && !sampleVersions.includes(app.version)) {
        sampleVersions = [...sampleVersions, app.version].slice(-5);
      }

      await db
        .update(discoveredApps)
        .set({
          sightingCount: sql`${discoveredApps.sightingCount} + 1`,
          lastSeenAt: now,
          updatedAt: now,
          appName: app.bundleId && !existing.bundleId ? app.appName : existing.appName,
          bundleId: app.bundleId ?? existing.bundleId,
          teamId: app.teamId ?? existing.teamId,
          sampleVersions: JSON.stringify(sampleVersions),
          sparkleFeedUrl: app.sparkleFeedUrl ?? existing.sparkleFeedUrl,
          sparklePublicKey: app.sparklePublicKey ?? existing.sparklePublicKey,
          isSparkleApp: app.isSparkleApp ?? existing.isSparkleApp,
          isMasApp: app.isMasApp ?? existing.isMasApp,
          masAppId: app.masAppId ?? existing.masAppId,
          isElectronApp: app.isElectronApp ?? existing.isElectronApp,
          electronUpdateProvider: app.electronUpdateProvider ?? existing.electronUpdateProvider,
          electronUpdateUrl: app.electronUpdateUrl ?? existing.electronUpdateUrl,
          codeSigningAuthority: app.codeSigningAuthority ?? existing.codeSigningAuthority,
          appCategory: app.appCategory ?? existing.appCategory,
          minMacOSVersion: app.minMacOSVersion ?? existing.minMacOSVersion,
          homebrewCaskToken: app.homebrewCaskToken ?? existing.homebrewCaskToken,
        })
        .where(eq(discoveredApps.id, existing.id));

      persistedByKey.set(key, { id: existing.id, iconR2Key: existing.iconR2Key });
      continue;
    }

    const newId = generateId(idPrefixes.discoveredApp);
    await db.insert(discoveredApps).values({
      id: newId,
      lookupKey: key,
      appName: app.appName,
      bundleId: app.bundleId ?? null,
      teamId: app.teamId ?? null,
      sightingCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      status: "pending",
      linkedAppId: null,
      sampleVersions: JSON.stringify(app.version ? [app.version] : []),
      sparkleFeedUrl: app.sparkleFeedUrl ?? null,
      sparklePublicKey: app.sparklePublicKey ?? null,
      isSparkleApp: app.isSparkleApp ?? null,
      isMasApp: app.isMasApp ?? null,
      masAppId: app.masAppId ?? null,
      isElectronApp: app.isElectronApp ?? null,
      electronUpdateProvider: app.electronUpdateProvider ?? null,
      electronUpdateUrl: app.electronUpdateUrl ?? null,
      codeSigningAuthority: app.codeSigningAuthority ?? null,
      appCategory: app.appCategory ?? null,
      minMacOSVersion: app.minMacOSVersion ?? null,
      homebrewCaskToken: app.homebrewCaskToken ?? null,
      createdAt: now,
      updatedAt: now,
    });

    persistedByKey.set(key, { id: newId, iconR2Key: null });
  }

  return persistedByKey;
}

async function upsertSuggestion(params: {
  db: ReturnType<typeof createDb>;
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
  const {
    db,
    queueType,
    dedupeKey,
    title,
    proposedChangeJson,
    canonicalSnapshotJson,
    appId,
    sourceId,
    bundleKey,
    evidenceType,
    evidenceFingerprint,
    evidencePayloadJson,
    now,
  } = params;

  // Atomic upsert — avoids TOCTOU race on the dedupeKey unique index
  await db
    .insert(catalogSuggestions)
    .values({
      id: generateId(idPrefixes.catalogSuggestion),
      queueType,
      status: "pending",
      appId: appId ?? null,
      sourceId: sourceId ?? null,
      bundleKey: bundleKey ?? null,
      dedupeKey,
      title,
      canonicalSnapshotJson: canonicalSnapshotJson ?? null,
      proposedChangeJson,
      evidenceSummaryJson: evidencePayloadJson,
      evidenceCount: 1,
      firstSeenAt: now,
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: catalogSuggestions.dedupeKey,
      set: {
        appId: sql`coalesce(${appId ?? null}, ${catalogSuggestions.appId})`,
        sourceId: sql`coalesce(${sourceId ?? null}, ${catalogSuggestions.sourceId})`,
        title,
        canonicalSnapshotJson: sql`coalesce(${canonicalSnapshotJson ?? null}, ${catalogSuggestions.canonicalSnapshotJson})`,
        proposedChangeJson,
        evidenceSummaryJson: evidencePayloadJson,
        evidenceCount: sql`${catalogSuggestions.evidenceCount} + 1`,
        lastSeenAt: now,
        updatedAt: now,
      },
    });

  const suggestion = await db
    .select()
    .from(catalogSuggestions)
    .where(eq(catalogSuggestions.dedupeKey, dedupeKey))
    .get();
  if (!suggestion) return;

  // Atomic evidence insert — avoids TOCTOU race on the fingerprint unique index
  await db
    .insert(suggestionEvidence)
    .values({
      id: generateId(idPrefixes.suggestionEvidence),
      suggestionId: suggestion.id,
      appId: appId ?? null,
      sourceId: sourceId ?? null,
      evidenceType,
      fingerprint: evidenceFingerprint,
      payloadJson: evidencePayloadJson,
      observedAt: now,
      createdAt: now,
    })
    .onConflictDoNothing();
}

async function findExistingAlias(params: {
  db: ReturnType<typeof createDb>;
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
  db: ReturnType<typeof createDb>;
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
  db: ReturnType<typeof createDb>;
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
  db: ReturnType<typeof createDb>;
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
  db: ReturnType<typeof createDb>;
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

/**
 * Decodes base64 icon data, hashes it, and stores it in R2.
 * Returns the R2 key or null on failure.
 */
async function storeIcon(bucket: R2Bucket, iconBase64: string): Promise<string | null> {
  try {
    const binaryString = atob(iconBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)!;
    }
    const body = bytes.buffer as ArrayBuffer;

    if (body.byteLength > 512 * 1024) return null;

    const contentDigest = await crypto.subtle.digest("SHA-256", body);
    const contentHash = Array.from(new Uint8Array(contentDigest))
      .map((b) => b.toString(16).padStart(2, "0"))
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

function pickPreferredAliasMap(
  aliases: Array<{
    appId: string;
    aliasType: string;
    value: string;
    isExact: boolean;
    confidenceWeight: number;
  }>,
  aliasType: string,
): Map<string, string> {
  const map = new Map<string, { value: string; confidenceWeight: number }>();

  for (const alias of aliases) {
    if (alias.aliasType !== aliasType || !alias.isExact) continue;
    const existing = map.get(alias.appId);
    if (!existing || alias.confidenceWeight > existing.confidenceWeight) {
      map.set(alias.appId, { value: alias.value, confidenceWeight: alias.confidenceWeight });
    }
  }

  return new Map(Array.from(map.entries(), ([appId, entry]) => [appId, entry.value]));
}

type InventoryEnv = {
  Bindings: Env;
  Variables: { inventoryRequest: z.infer<typeof inventoryCheckRequestSchema> };
};

const gzipJsonMiddleware = createMiddleware<InventoryEnv>(async (c, next) => {
  let body: unknown;
  try {
    if (c.req.header("content-encoding") === "gzip") {
      const compressed = await c.req.arrayBuffer();
      const decompressed = new Response(
        new Blob([compressed]).stream().pipeThrough(new DecompressionStream("gzip")),
      );
      body = await decompressed.json();
    } else {
      body = await c.req.json();
    }
  } catch {
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }
  const parsed = inventoryCheckRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new HTTPException(400, {
      res: Response.json(
        { error: "Invalid request", details: parsed.error.issues },
        { status: 400 },
      ),
    });
  }
  c.set("inventoryRequest", parsed.data);
  await next();
});

export const inventoryRoutes = new Hono<InventoryEnv>()
  // POST /v1/inventory/check
  // TODO: Pre-compute inventory snapshot in KV, rebuilt on catalog changes, to avoid full-table loads
  .post("/inventory/check", gzipJsonMiddleware, async (c) => {
    const request = c.get("inventoryRequest");
    const db = createDb(c.env.DB);
    const now = new Date().toISOString();

    // Load all active aliases for matching
    const allAliases = await db
      .select({
        appId: appAliases.appId,
        aliasType: appAliases.aliasType,
        value: appAliases.value,
        normalizedValue: appAliases.normalizedValue,
        isExact: appAliases.isExact,
        confidenceWeight: appAliases.confidenceWeight,
      })
      .from(appAliases)
      .where(eq(appAliases.isActive, true))
      .limit(10_000)
      .all();

    // Load app details
    const appMap = new Map<
      string,
      {
        canonicalName: string;
        iconR2Key: string | null;
        status: "draft" | "public" | "merged" | "deprecated" | "unlisted";
      }
    >();
    const allApps = await db
      .select({
        id: apps.id,
        canonicalName: apps.canonicalName,
        iconR2Key: apps.iconR2Key,
        status: apps.status,
      })
      .from(apps)
      .limit(10_000)
      .all();
    for (const a of allApps) {
      appMap.set(a.id, {
        canonicalName: a.canonicalName,
        iconR2Key: a.iconR2Key,
        status: a.status,
      });
    }

    const aliasRecords: AliasRecord[] = allAliases.map((a) => ({
      appId: a.appId,
      appName: appMap.get(a.appId)?.canonicalName ?? "Unknown",
      aliasType: a.aliasType,
      value: a.value,
      normalizedValue: a.normalizedValue,
      isExact: a.isExact,
      confidenceWeight: a.confidenceWeight,
    }));
    const caskTokenByApp = pickPreferredAliasMap(allAliases, "homebrew_cask");
    const sparkleTrustAssertions: TrustAssertionRecord[] = (
      await db
        .select({
          appId: trustAssertions.appId,
          assertionType: trustAssertions.assertionType,
          value: trustAssertions.value,
        })
        .from(trustAssertions)
        .where(eq(trustAssertions.assertionType, "sparkle_public_key"))
        .limit(10_000)
        .all()
    ).flatMap((assertion) =>
      assertion.appId
        ? [
            {
              appId: assertion.appId,
              assertionType: assertion.assertionType,
              value: assertion.value,
            },
          ]
        : [],
    );

    // Load all latest releases, indexed by appId → channel → release
    const latestReleases = await db.select().from(appLatestReleases).limit(10_000).all();
    const latestByAppChannel = new Map<string, Map<string, (typeof latestReleases)[number]>>();
    for (const lr of latestReleases) {
      let channelMap = latestByAppChannel.get(lr.appId);
      if (!channelMap) {
        channelMap = new Map();
        latestByAppChannel.set(lr.appId, channelMap);
      }
      channelMap.set(lr.channel, lr);
    }

    // Extract channel preferences from client request
    const channelPrefs = request.client.channelPreferences;
    const defaultChannel = channelPrefs?.defaultChannel ?? "stable";
    const perAppChannels = channelPrefs?.perApp ?? {};

    // Load source lastSuccessAt for staleness computation
    const allSources = await db
      .select({ appId: sources.appId, lastSuccessAt: sources.lastSuccessAt })
      .from(sources)
      .where(
        and(
          eq(sources.status, "active"),
          eq(sources.reviewStatus, "approved"),
          eq(sources.role, "authority"),
        ),
      )
      .limit(10_000)
      .all();
    const latestSourceSuccessByApp = new Map<string, string | null>();
    for (const s of allSources) {
      const existing = latestSourceSuccessByApp.get(s.appId);
      if (!existing || (s.lastSuccessAt && (!existing || s.lastSuccessAt > existing))) {
        latestSourceSuccessByApp.set(s.appId, s.lastSuccessAt);
      }
    }

    // Process each app
    const results: AppDecision[] = [];

    for (const installedApp of request.apps) {
      const matchResult = matchApp(
        {
          appName: installedApp.appName,
          bundleId: installedApp.bundleId,
          teamId: installedApp.teamId,
          version: installedApp.version,
          sparkleFeedUrl: installedApp.sparkleFeedUrl,
          sparklePublicKey: installedApp.sparklePublicKey,
          masAppId: installedApp.masAppId,
          electronUpdateUrl: installedApp.electronUpdateUrl,
          homebrewCaskToken: installedApp.homebrewCaskToken,
        },
        aliasRecords,
        sparkleTrustAssertions,
      );

      let decision: AppDecision["decision"] = "local_only";
      let trackingState: AppDecision["trackingState"] = "local_only";
      let localReasonCode: AppDecision["localReasonCode"] = "not_found";
      let latestVersion: string | null = null;
      let latestVersionRaw: string | null = null;
      let latestVersionNormalized: string | null = null;
      let releasedAt: string | null = null;
      let latestReleaseId: string | null = null;
      let matchedArtifact: AppDecision["artifact"] = null;
      let installStrategy: AppDecision["installStrategy"] = null;
      let resolvedChannel: string | null = null;
      let staleSince: string | null = null;

      const appInfo = matchResult.appId ? appMap.get(matchResult.appId) : undefined;
      const isPublic = appInfo?.status === "public";

      if (matchResult.matched && matchResult.appId) {
        if (!isPublic) {
          localReasonCode = appInfo?.status === "draft" ? "matched_draft" : "no_approved_source";
        } else {
          const requestedChannel = perAppChannels[matchResult.appId] ?? defaultChannel;
          const channelMap = latestByAppChannel.get(matchResult.appId);
          const latest = channelMap
            ? (channelMap.get(requestedChannel) ?? channelMap.get("stable"))
            : undefined;
          if (latest) {
            trackingState = "public";
            localReasonCode = null;
            // Compute staleness
            const lastSuccess = latestSourceSuccessByApp.get(matchResult.appId) ?? null;
            staleSince = computeStaleSince(lastSuccess);

            // Find a compatible artifact for this client's arch + OS
            const releaseArtifacts = await db
              .select()
              .from(artifacts)
              .where(eq(artifacts.releaseId, latest.releaseId))
              .all();

            const clientArch = request.client.systemArchitecture;
            const clientOs = request.client.osVersion;

            const compatibleArtifact = releaseArtifacts.find(
              (a) =>
                isArchCompatible(a.architecture, clientArch) &&
                isOsVersionCompatible(clientOs, a.minOsVersion),
            );

            if (compatibleArtifact || releaseArtifacts.length === 0) {
              latestVersion = displayVersion(latest.versionRaw);
              latestVersionRaw = latest.versionRaw;
              latestVersionNormalized = latest.versionNormalized;
              releasedAt = latest.releasedAt;
              latestReleaseId = latest.releaseId;
              installStrategy = latest.installStrategy;
              resolvedChannel = latest.channel;

              if (compatibleArtifact) {
                matchedArtifact = {
                  id: compatibleArtifact.id,
                  downloadUrl: compatibleArtifact.url,
                  architecture: compatibleArtifact.architecture,
                  minOsVersion: compatibleArtifact.minOsVersion,
                  artifactType: compatibleArtifact.artifactType,
                  sizeBytes: compatibleArtifact.sizeBytes,
                  sha256: compatibleArtifact.sha256,
                };
              }
            } else {
              // Latest release has no compatible artifact — walk back through older releases
              const olderCompatible = await db
                .select({
                  releaseId: releases.id,
                  versionNormalized: releases.versionNormalized,
                  versionRaw: releases.versionRaw,
                  releasedAt: releases.releasedAt,
                  artifactId: artifacts.id,
                  artifactUrl: artifacts.url,
                  artifactArch: artifacts.architecture,
                  artifactMinOs: artifacts.minOsVersion,
                  artifactType: artifacts.artifactType,
                  artifactSize: artifacts.sizeBytes,
                  artifactSha256: artifacts.sha256,
                })
                .from(releases)
                .innerJoin(artifacts, eq(artifacts.releaseId, releases.id))
                .where(
                  and(
                    eq(releases.appId, matchResult.appId!),
                    eq(releases.status, "active"),
                    eq(releases.channel, latest.channel),
                  ),
                )
                .orderBy(desc(releases.versionNormalized))
                .limit(100)
                .all();

              const found = olderCompatible.find(
                (r) =>
                  isArchCompatible(r.artifactArch, clientArch) &&
                  isOsVersionCompatible(clientOs, r.artifactMinOs),
              );

              if (found) {
                latestVersion = displayVersion(found.versionRaw);
                latestVersionRaw = found.versionRaw;
                latestVersionNormalized = found.versionNormalized;
                releasedAt = found.releasedAt;
                latestReleaseId = found.releaseId;
                installStrategy = latest.installStrategy;
                resolvedChannel = latest.channel;
                matchedArtifact = {
                  id: found.artifactId,
                  downloadUrl: found.artifactUrl,
                  architecture: found.artifactArch,
                  minOsVersion: found.artifactMinOs,
                  artifactType: found.artifactType,
                  sizeBytes: found.artifactSize,
                  sha256: found.artifactSha256,
                };
              }
            }

            if (latestVersion) {
              if (installedApp.version) {
                // Compare normalized strings directly — they are zero-padded
                // for lexicographic ordering.  Re-parsing via compareVersionStrings()
                // would mangle pre-release suffixes (e.g. "-0.001.…" → extra segments).
                const installedNormalized = normalizeVersion(installedApp.version);
                if (latestVersionNormalized && installedNormalized >= latestVersionNormalized) {
                  decision = "up_to_date";
                } else {
                  decision = "update_available";
                }
              } else {
                decision = "ambiguous";
              }
            } else {
              decision = "local_only";
              trackingState = "local_only";
              localReasonCode = "no_approved_source";
            }
          } else {
            trackingState = "local_only";
            localReasonCode = "no_approved_source";
          }
        }
      }

      if (matchResult.ambiguous) {
        decision = "ambiguous";
        trackingState = "local_only";
        localReasonCode = "ambiguous_match";
      }

      const iconUrl = appInfo?.iconR2Key ? `${c.env.ASSETS_BASE_URL}/${appInfo.iconR2Key}` : null;

      results.push({
        appName: installedApp.appName,
        bundleId: installedApp.bundleId ?? null,
        installedVersion: installedApp.version ?? null,
        matchedAppId: matchResult.appId,
        matchedAppName: matchResult.appName,
        matchConfidence: matchResult.confidence,
        decision,
        trackingState,
        localReasonCode,
        latestVersion,
        latestVersionRaw,
        homebrewCaskToken: matchResult.appId
          ? (caskTokenByApp.get(matchResult.appId) ?? null)
          : null,
        latestReleaseId,
        channel: resolvedChannel,
        availableChannels: matchResult.appId
          ? [...(latestByAppChannel.get(matchResult.appId)?.keys() ?? [])]
          : undefined,
        releasedAt,
        staleSince,
        iconUrl,
        artifact: matchedArtifact,
        installStrategy,
      });
    }

    const resultByLookupKey = new Map(
      results.map((result) => [computeLookupKey(result.appName, result.bundleId), result] as const),
    );
    const unmatchedByKey = collectUnmatchedApps(request.apps, resultByLookupKey);
    const persistedDiscoveries = await upsertDiscoveredApps({
      db,
      unmatchedByKey,
      now,
    });

    // Non-critical follow-up work runs after the response. The discovered app rows
    // themselves are already persisted above so the dashboard cannot show a partial batch.
    c.executionCtx.waitUntil(
      (async () => {
        for (const [key, app] of unmatchedByKey) {
          if (!app.iconBase64) continue;
          const persisted = persistedDiscoveries.get(key);
          if (!persisted || persisted.iconR2Key) continue;

          const iconKey = await storeIcon(c.env.ASSETS_BUCKET, app.iconBase64);
          if (iconKey) {
            await db
              .update(discoveredApps)
              .set({ iconR2Key: iconKey })
              .where(eq(discoveredApps.id, persisted.id));
          }
        }

        // Backfill icons for matched catalog apps that are missing them
        for (const installedApp of request.apps) {
          if (!installedApp.iconBase64) continue;
          const key = computeLookupKey(installedApp.appName, installedApp.bundleId);
          const result = resultByLookupKey.get(key);
          if (!result?.matchedAppId) continue;

          // Re-check from DB to avoid races with concurrent requests
          const appRow = await db
            .select({ id: apps.id, slug: apps.slug, iconR2Key: apps.iconR2Key })
            .from(apps)
            .where(eq(apps.id, result.matchedAppId))
            .get();
          if (!appRow || appRow.iconR2Key) continue;

          try {
            const iconKey = await storeIcon(c.env.ASSETS_BUCKET, installedApp.iconBase64);
            if (iconKey) {
              await db
                .update(apps)
                .set({ iconR2Key: iconKey, updatedAt: now })
                .where(eq(apps.id, appRow.id));
            }
          } catch {
            // Non-critical — continue
          }
        }

        // Keep approved apps accruing alias, source, and trust suggestions instead of icons only
        for (const installedApp of request.apps) {
          const lookupKey = computeLookupKey(installedApp.appName, installedApp.bundleId);
          const result = resultByLookupKey.get(lookupKey);
          if (!result?.matchedAppId || result.trackingState !== "public") continue;

          const appRow = await db
            .select({
              id: apps.id,
              canonicalName: apps.canonicalName,
              vendorName: apps.vendorName,
              homepageUrl: apps.homepageUrl,
              status: apps.status,
            })
            .from(apps)
            .where(eq(apps.id, result.matchedAppId))
            .get();
          if (!appRow) continue;

          const canonicalSnapshotJson = JSON.stringify({
            canonicalName: appRow.canonicalName,
            vendorName: appRow.vendorName,
            homepageUrl: appRow.homepageUrl,
            status: appRow.status,
          });

          if (installedApp.bundleId) {
            await createAliasSuggestion({
              db,
              appId: appRow.id,
              appName: appRow.canonicalName,
              lookupKey,
              aliasType: "bundle_id",
              value: installedApp.bundleId,
              canonicalSnapshotJson,
              evidenceType: "scan",
              evidenceFingerprint: `public-bundle:${lookupKey}:${installedApp.bundleId}`,
              evidencePayloadJson: JSON.stringify({ bundleId: installedApp.bundleId }),
              now,
            });
          }

          if (installedApp.teamId) {
            await createAliasSuggestion({
              db,
              appId: appRow.id,
              appName: appRow.canonicalName,
              lookupKey,
              aliasType: "team_id",
              value: installedApp.teamId,
              canonicalSnapshotJson,
              evidenceType: "scan",
              evidenceFingerprint: `public-team:${lookupKey}:${installedApp.teamId}`,
              evidencePayloadJson: JSON.stringify({ teamId: installedApp.teamId }),
              now,
            });
          }

          if (installedApp.masAppId) {
            await createAliasSuggestion({
              db,
              appId: appRow.id,
              appName: appRow.canonicalName,
              lookupKey,
              aliasType: "mas_app_id",
              value: installedApp.masAppId,
              canonicalSnapshotJson,
              evidenceType: "scan",
              evidenceFingerprint: `public-mas-id:${lookupKey}:${installedApp.masAppId}`,
              evidencePayloadJson: JSON.stringify({ masAppId: installedApp.masAppId }),
              now,
            });
          }

          if (installedApp.homebrewCaskToken) {
            await createAliasSuggestion({
              db,
              appId: appRow.id,
              appName: appRow.canonicalName,
              lookupKey,
              aliasType: "homebrew_cask",
              value: installedApp.homebrewCaskToken,
              canonicalSnapshotJson,
              evidenceType: "scan",
              evidenceFingerprint: `public-homebrew:${lookupKey}:${installedApp.homebrewCaskToken}`,
              evidencePayloadJson: JSON.stringify({
                homebrewCaskToken: installedApp.homebrewCaskToken,
              }),
              now,
            });
          }

          if (installedApp.electronUpdateUrl) {
            await createAliasSuggestion({
              db,
              appId: appRow.id,
              appName: appRow.canonicalName,
              lookupKey,
              aliasType: "electron_update_url",
              value: installedApp.electronUpdateUrl,
              canonicalSnapshotJson,
              evidenceType: "scan",
              evidenceFingerprint: `public-electron-alias:${lookupKey}:${installedApp.electronUpdateUrl}`,
              evidencePayloadJson: JSON.stringify({
                electronUpdateUrl: installedApp.electronUpdateUrl,
                electronUpdateProvider: installedApp.electronUpdateProvider ?? null,
              }),
              now,
            });
          }

          if (installedApp.sparkleFeedUrl) {
            await createSourceSuggestion({
              db,
              appId: appRow.id,
              appName: appRow.canonicalName,
              lookupKey,
              sourceType: "sparkle",
              baseUrl: installedApp.sparkleFeedUrl,
              canonicalSnapshotJson,
              evidenceType: "scan",
              evidenceFingerprint: `public-sparkle:${lookupKey}:${installedApp.sparkleFeedUrl}`,
              evidencePayloadJson: JSON.stringify({
                sparkleFeedUrl: installedApp.sparkleFeedUrl,
                sparklePublicKey: installedApp.sparklePublicKey ?? null,
              }),
              now,
            });
          }

          if (installedApp.electronUpdateUrl) {
            await createSourceSuggestion({
              db,
              appId: appRow.id,
              appName: appRow.canonicalName,
              lookupKey,
              sourceType: "electron_generic",
              baseUrl: installedApp.electronUpdateUrl,
              canonicalSnapshotJson,
              evidenceType: "scan",
              evidenceFingerprint: `public-electron:${lookupKey}:${installedApp.electronUpdateUrl}`,
              evidencePayloadJson: JSON.stringify({
                electronUpdateUrl: installedApp.electronUpdateUrl,
                electronUpdateProvider: installedApp.electronUpdateProvider ?? null,
              }),
              now,
            });
          }

          if (installedApp.isMasApp && installedApp.bundleId) {
            const lookupUrl = resolveSourceUrl("mac_app_store", installedApp.bundleId)!;
            await createSourceSuggestion({
              db,
              appId: appRow.id,
              appName: appRow.canonicalName,
              lookupKey,
              sourceType: "mac_app_store",
              baseUrl: lookupUrl,
              canonicalSnapshotJson,
              evidenceType: "scan",
              evidenceFingerprint: `public-mas:${lookupKey}:${lookupUrl}`,
              evidencePayloadJson: JSON.stringify({
                bundleId: installedApp.bundleId,
                lookupUrl,
              }),
              now,
            });
          }

          if (installedApp.sparklePublicKey && installedApp.sparkleFeedUrl) {
            const sparkleSource = await findExistingSource({
              db,
              appId: appRow.id,
              sourceType: "sparkle",
              baseUrl: installedApp.sparkleFeedUrl,
            });
            if (sparkleSource) {
              await createTrustAssertionSuggestion({
                db,
                appId: appRow.id,
                appName: appRow.canonicalName,
                lookupKey,
                sourceId: sparkleSource.id,
                assertionType: "sparkle_public_key",
                value: installedApp.sparklePublicKey,
                canonicalSnapshotJson,
                evidenceFingerprint: `public-sparkle-key:${lookupKey}:${installedApp.sparklePublicKey}`,
                evidencePayloadJson: JSON.stringify({
                  sparkleFeedUrl: installedApp.sparkleFeedUrl,
                  sparklePublicKey: installedApp.sparklePublicKey,
                }),
                now,
              });
            }
          }
        }
      })(),
    );

    return c.json({
      results,
      processedAt: now,
    });
  });
