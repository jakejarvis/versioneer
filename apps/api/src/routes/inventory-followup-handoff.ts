import { inArray, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import {
  inventoryFollowupPayloadR2Key,
  recordJobFailure,
  type InventoryFollowupDiscoveredIconCandidate,
  type InventoryFollowupMatchedAppCandidate,
  type InventoryFollowupPayload,
  type InventoryFollowupQueueMessage,
} from "@versioneer/core/pipeline";
import type { AppDecision, InstalledApp } from "@versioneer/core/validation";
import { createDb } from "@versioneer/db";
import { discoveredApps, generateId, idPrefixes, inventoryFollowupJobs } from "@versioneer/db";

import { D1_PARAM_LIMIT } from "../lib/constants";

type Db = ReturnType<typeof createDb>;

export type DiscoveryCandidate = {
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

export type PersistedDiscovery = {
  id: string;
  iconR2Key: string | null;
};

export function computeLookupKey(appName: string, bundleId?: string | null): string {
  if (bundleId) return `bid:${bundleId.toLowerCase()}`;
  return `name:${appName
    .toLowerCase()
    .trim()
    .replace(/\\.app$/, "")}`;
}

async function selectDiscoveredAppsByLookupKeys(db: Db, lookupKeys: string[]) {
  const rows = [];
  for (let index = 0; index < lookupKeys.length; index += D1_PARAM_LIMIT) {
    const chunk = lookupKeys.slice(index, index + D1_PARAM_LIMIT);
    if (chunk.length === 0) continue;

    rows.push(
      ...(await db
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
        .all()),
    );
  }

  return rows;
}

function parseSampleVersions(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function nextSampleVersions(existing: string | null, version?: string | null): string[] {
  const sampleVersions = parseSampleVersions(existing);
  if (version && !sampleVersions.includes(version)) {
    return [...sampleVersions, version].slice(-5);
  }
  return sampleVersions;
}

export function collectUnmatchedApps(
  installedApps: InstalledApp[],
  resultByLookupKey: ReadonlyMap<string, AppDecision>,
): Map<string, DiscoveryCandidate> {
  const unmatchedByKey = new Map<string, DiscoveryCandidate>();

  for (const installedApp of installedApps) {
    const lookupKey = computeLookupKey(installedApp.appName, installedApp.bundleId);
    const result = resultByLookupKey.get(lookupKey);
    if (result?.trackingState === "public" || unmatchedByKey.has(lookupKey)) {
      continue;
    }

    unmatchedByKey.set(lookupKey, {
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

export async function upsertDiscoveredApps(params: {
  db: Db;
  unmatchedByKey: Map<string, DiscoveryCandidate>;
  now: string;
}): Promise<Map<string, PersistedDiscovery>> {
  const { db, unmatchedByKey, now } = params;
  const persistedByKey = new Map<string, PersistedDiscovery>();
  if (unmatchedByKey.size === 0) return persistedByKey;

  const allKeys = [...unmatchedByKey.keys()];
  const existingRows = await selectDiscoveredAppsByLookupKeys(db, allKeys);
  const existingByKey = new Map(existingRows.map((row) => [row.lookupKey, row] as const));

  const writes: BatchItem<"sqlite">[] = [...unmatchedByKey].map(([lookupKey, app]) => {
    const existing = existingByKey.get(lookupKey);
    const sampleVersions = JSON.stringify(
      nextSampleVersions(existing?.sampleVersions ?? null, app.version),
    );
    const newId = generateId(idPrefixes.discoveredApp);

    return db
      .insert(discoveredApps)
      .values({
        id: newId,
        lookupKey,
        appName: app.appName,
        bundleId: app.bundleId ?? null,
        teamId: app.teamId ?? null,
        sightingCount: 1,
        firstSeenAt: now,
        lastSeenAt: now,
        status: "pending",
        linkedAppId: null,
        sampleVersions,
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
      })
      .onConflictDoUpdate({
        target: discoveredApps.lookupKey,
        set: {
          sightingCount: sql`${discoveredApps.sightingCount} + 1`,
          lastSeenAt: now,
          updatedAt: now,
          appName: sql`case when ${discoveredApps.bundleId} is null and ${app.bundleId ?? null} is not null then ${app.appName} else ${discoveredApps.appName} end`,
          bundleId: sql`coalesce(${discoveredApps.bundleId}, ${app.bundleId ?? null})`,
          teamId: sql`coalesce(${discoveredApps.teamId}, ${app.teamId ?? null})`,
          sampleVersions: existing
            ? sampleVersions
            : sql`coalesce(${discoveredApps.sampleVersions}, ${sampleVersions})`,
          sparkleFeedUrl: sql`coalesce(${discoveredApps.sparkleFeedUrl}, ${app.sparkleFeedUrl ?? null})`,
          sparklePublicKey: sql`coalesce(${discoveredApps.sparklePublicKey}, ${app.sparklePublicKey ?? null})`,
          isSparkleApp: sql`coalesce(${discoveredApps.isSparkleApp}, ${app.isSparkleApp ?? null})`,
          isMasApp: sql`coalesce(${discoveredApps.isMasApp}, ${app.isMasApp ?? null})`,
          masAppId: sql`coalesce(${discoveredApps.masAppId}, ${app.masAppId ?? null})`,
          isElectronApp: sql`coalesce(${discoveredApps.isElectronApp}, ${app.isElectronApp ?? null})`,
          electronUpdateProvider: sql`coalesce(${discoveredApps.electronUpdateProvider}, ${app.electronUpdateProvider ?? null})`,
          electronUpdateUrl: sql`coalesce(${discoveredApps.electronUpdateUrl}, ${app.electronUpdateUrl ?? null})`,
          codeSigningAuthority: sql`coalesce(${discoveredApps.codeSigningAuthority}, ${app.codeSigningAuthority ?? null})`,
          appCategory: sql`coalesce(${discoveredApps.appCategory}, ${app.appCategory ?? null})`,
          minMacOSVersion: sql`coalesce(${discoveredApps.minMacOSVersion}, ${app.minMacOSVersion ?? null})`,
          homebrewCaskToken: sql`coalesce(${discoveredApps.homebrewCaskToken}, ${app.homebrewCaskToken ?? null})`,
        },
      });
  });

  if (writes.length > 0) {
    const firstWrite = writes[0];
    if (!firstWrite) {
      throw new Error("Expected discovered app writes for inventory follow-up handoff");
    }
    await db.batch([firstWrite, ...writes.slice(1)]);
  }

  const persistedRows = await selectDiscoveredAppsByLookupKeys(db, allKeys);
  for (const row of persistedRows) {
    persistedByKey.set(row.lookupKey, { id: row.id, iconR2Key: row.iconR2Key });
  }

  if (persistedByKey.size !== unmatchedByKey.size) {
    throw new Error("Discovered app batch did not persist every lookup key");
  }

  return persistedByKey;
}

function candidateHasSuggestionData(app: InstalledApp): boolean {
  return Boolean(
    app.bundleId ||
    app.teamId ||
    app.masAppId ||
    app.homebrewCaskToken ||
    app.electronUpdateUrl ||
    app.sparkleFeedUrl ||
    (app.isMasApp && app.bundleId) ||
    (app.sparklePublicKey && app.sparkleFeedUrl),
  );
}

export function buildInventoryFollowupPayload(params: {
  requestApps: InstalledApp[];
  resultsByLookupKey: ReadonlyMap<string, AppDecision>;
  unmatchedByKey: ReadonlyMap<string, DiscoveryCandidate>;
  persistedDiscoveries: ReadonlyMap<string, PersistedDiscovery>;
  processedAt: string;
}): InventoryFollowupPayload {
  const discoveredIconCandidates: InventoryFollowupDiscoveredIconCandidate[] = [];
  for (const [lookupKey, app] of params.unmatchedByKey) {
    if (!app.iconBase64) continue;
    const persisted = params.persistedDiscoveries.get(lookupKey);
    if (!persisted || persisted.iconR2Key) continue;
    discoveredIconCandidates.push({
      discoveredAppId: persisted.id,
      lookupKey,
      iconBase64: app.iconBase64,
    });
  }

  const matchedAppCandidates: InventoryFollowupMatchedAppCandidate[] = [];
  for (const installedApp of params.requestApps) {
    const lookupKey = computeLookupKey(installedApp.appName, installedApp.bundleId);
    const result = params.resultsByLookupKey.get(lookupKey);
    if (!result?.matchedAppId) continue;

    const createSuggestions =
      result.trackingState === "public" && candidateHasSuggestionData(installedApp);
    if (!installedApp.iconBase64 && !createSuggestions) continue;

    matchedAppCandidates.push({
      appId: result.matchedAppId,
      lookupKey,
      createSuggestions,
      iconBase64: installedApp.iconBase64 ?? null,
      bundleId: installedApp.bundleId ?? null,
      teamId: installedApp.teamId ?? null,
      sparkleFeedUrl: installedApp.sparkleFeedUrl ?? null,
      sparklePublicKey: installedApp.sparklePublicKey ?? null,
      isMasApp: installedApp.isMasApp ?? null,
      masAppId: installedApp.masAppId ?? null,
      electronUpdateProvider: installedApp.electronUpdateProvider ?? null,
      electronUpdateUrl: installedApp.electronUpdateUrl ?? null,
      homebrewCaskToken: installedApp.homebrewCaskToken ?? null,
    });
  }

  return {
    version: 1,
    processedAt: params.processedAt,
    discoveredIconCandidates,
    matchedAppCandidates,
  };
}

export function inventoryFollowupItemCount(payload: InventoryFollowupPayload): number {
  return payload.discoveredIconCandidates.length + payload.matchedAppCandidates.length;
}

export async function persistAndEnqueueInventoryFollowup(params: {
  db: Db;
  env: Env;
  payload: InventoryFollowupPayload;
  now: string;
}): Promise<void> {
  const itemsTotal = inventoryFollowupItemCount(params.payload);
  if (itemsTotal === 0) return;

  const jobId = generateId(idPrefixes.inventoryFollowupJob);
  const payloadR2Key = inventoryFollowupPayloadR2Key(jobId, new Date(params.now));

  try {
    await params.env.RAW_BUCKET.put(payloadR2Key, JSON.stringify(params.payload), {
      httpMetadata: { contentType: "application/json" },
    });

    await params.db.insert(inventoryFollowupJobs).values({
      id: jobId,
      status: "pending",
      payloadR2Key,
      attemptCount: 0,
      itemsTotal,
      createdAt: params.now,
      updatedAt: params.now,
    });

    try {
      await params.env.INVENTORY_FOLLOWUP_QUEUE.send({
        jobId,
      } satisfies InventoryFollowupQueueMessage);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await recordJobFailure({
        db: params.db,
        jobType: "inventory_followup",
        relatedId: jobId,
        jobKey: "enqueue",
        errorMessage,
      });
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    try {
      await recordJobFailure({
        db: params.db,
        jobType: "inventory_followup",
        relatedId: jobId,
        jobKey: "handoff",
        errorMessage,
      });
    } catch {
      // Inventory decisions are still useful even if best-effort failure tracking fails.
    }
  }
}
