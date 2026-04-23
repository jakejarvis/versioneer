import { and, desc, eq, inArray } from "drizzle-orm";
import { Hono } from "hono";

import { captureApiEvent } from "@/lib/observability";
import { clientRateLimit } from "@/middleware/rate-limit";
import { getInventoryMatchSnapshot } from "@versioneer/core/cache";
import { toEpochMs } from "@versioneer/core/dates";
import { matchApp } from "@versioneer/core/identity";
import type {
  AppDecision,
  InstallTrust,
  InstallTrustReason,
  InstalledApp,
} from "@versioneer/core/validation";
import { displayVersion, normalizeVersion } from "@versioneer/core/versioning";
import { createDb } from "@versioneer/db";
import { appLatestReleases, artifacts, releases, sources } from "@versioneer/db";
import {
  artifactCompatibilityIsKnown,
  artifactSupportsTarget,
  normalizeArtifactArchitecture,
  normalizeTargetArchitecture,
  rankArtifactForTarget,
  type TargetArchitecture,
} from "@versioneer/schemas/architecture";
import type { InstallStrategy } from "@versioneer/schemas/releases";

import { D1_PARAM_LIMIT } from "../lib/constants";
import { computeStaleSince, isOsVersionCompatible } from "./helpers";
import {
  buildInventoryFollowupPayload,
  collectUnmatchedApps,
  computeLookupKey,
  inventoryFollowupItemCount,
  persistAndEnqueueInventoryFollowup,
  upsertDiscoveredApps,
} from "./inventory-followup-handoff";
import { type InventoryEnv, gzipJsonMiddleware } from "./inventory-request";

type LatestReleaseRow = typeof appLatestReleases.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;
type LatestByAppChannel = Map<string, Map<string, Map<TargetArchitecture, LatestReleaseRow>>>;
type InventoryAppInfo = NonNullable<
  Awaited<ReturnType<typeof getInventoryMatchSnapshot>>["appsById"][string]
>;
type InventoryMatchPlan = {
  installedApp: InstalledApp;
  matchResult: ReturnType<typeof matchApp>;
  appInfo: InventoryAppInfo | undefined;
  isPublic: boolean;
  requestedChannel: string | null;
};

type CompatibleReleaseCandidate = {
  releaseId: string;
  versionNormalized: string;
  versionRaw: string;
  releasedAt: string | null;
  artifact: AppDecision["artifact"];
  installStrategy: InstallStrategy | null;
};

function inferInstallStrategy(
  sourceType: string | null,
  artifactType: string | null,
): InstallStrategy {
  if (sourceType === "sparkle") return "sparkle";
  if (sourceType === "mac_app_store") return "mac_app_store";
  if (artifactType === "dmg") return "dmg_copy_replace";
  if (artifactType === "zip") return "zip_replace";
  if (artifactType === "pkg") return "pkg_install";
  return "manual_only";
}

function installTrustBlocksOneClick(reasons: InstallTrustReason[]): boolean {
  return reasons.some(
    (reason) =>
      reason === "missing_artifact" ||
      reason === "missing_bundle_id" ||
      reason === "missing_team_id" ||
      reason === "manual_only" ||
      reason === "unsupported_strategy",
  );
}

function deriveInstallTrust(params: {
  decision: AppDecision["decision"];
  resolvedStrategy: InstallStrategy | null;
  artifact: AppDecision["artifact"];
  targetArchitecture: TargetArchitecture | null;
  installedApp: InstalledApp;
  homebrewCaskToken: string | null;
  hasApprovedSparklePublicKey: boolean;
}): InstallTrust {
  if (params.decision !== "update_available" || !params.resolvedStrategy) {
    return { status: "none", resolvedStrategy: null, reasons: [] };
  }

  if (params.homebrewCaskToken && params.installedApp.isHomebrewInstalled) {
    return {
      status: "external",
      resolvedStrategy: params.resolvedStrategy,
      reasons: ["homebrew_external"],
    };
  }

  if (params.resolvedStrategy === "mac_app_store") {
    return {
      status: "external",
      resolvedStrategy: params.resolvedStrategy,
      reasons: ["mac_app_store_external"],
    };
  }

  if (params.resolvedStrategy === "manual_only") {
    return {
      status: "manual_only",
      resolvedStrategy: params.resolvedStrategy,
      reasons: ["manual_only"],
    };
  }

  if (params.resolvedStrategy === "sparkle") {
    const reasons: InstallTrustReason[] = [];
    if (!params.installedApp.sparklePublicKey && !params.hasApprovedSparklePublicKey) {
      reasons.push("missing_sparkle_public_key");
    }
    if (
      params.artifact?.architecture &&
      !artifactCompatibilityIsKnown(params.artifact.architecture, params.targetArchitecture)
    ) {
      reasons.push("unknown_architecture");
    }
    return {
      status: "one_click",
      resolvedStrategy: params.resolvedStrategy,
      reasons,
    };
  }

  if (
    params.resolvedStrategy === "zip_replace" ||
    params.resolvedStrategy === "dmg_copy_replace" ||
    params.resolvedStrategy === "pkg_install"
  ) {
    const reasons: InstallTrustReason[] = [];
    if (!params.artifact?.downloadUrl) reasons.push("missing_artifact");
    if (!params.artifact?.sha256) reasons.push("missing_sha256");
    if (!params.installedApp.bundleId) reasons.push("missing_bundle_id");
    if (!params.installedApp.teamId) reasons.push("missing_team_id");
    if (
      params.artifact?.architecture &&
      !artifactCompatibilityIsKnown(params.artifact.architecture, params.targetArchitecture)
    ) {
      reasons.push("unknown_architecture");
    }
    return installTrustBlocksOneClick(reasons)
      ? { status: "manual_only", resolvedStrategy: params.resolvedStrategy, reasons }
      : { status: "one_click", resolvedStrategy: params.resolvedStrategy, reasons };
  }

  return {
    status: "manual_only",
    resolvedStrategy: params.resolvedStrategy,
    reasons: ["unsupported_strategy"],
  };
}

async function selectArtifactsByIds(
  db: ReturnType<typeof createDb>,
  artifactIds: string[],
): Promise<ArtifactRow[]> {
  const rows: ArtifactRow[] = [];
  for (let i = 0; i < artifactIds.length; i += D1_PARAM_LIMIT) {
    const chunk = artifactIds.slice(i, i + D1_PARAM_LIMIT);
    if (chunk.length === 0) continue;

    rows.push(...(await db.select().from(artifacts).where(inArray(artifacts.id, chunk)).all()));
  }
  return rows;
}

function uniqueStrings(values: Iterable<string | null | undefined>): string[] {
  return [...new Set([...values].filter((value): value is string => Boolean(value)))];
}

function chunkStrings(values: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < values.length; i += chunkSize) {
    chunks.push(values.slice(i, i + chunkSize));
  }
  return chunks;
}

async function selectLatestRowsForInventory(
  db: ReturnType<typeof createDb>,
  appIds: string[],
  channels: string[],
): Promise<LatestReleaseRow[]> {
  if (appIds.length === 0 || channels.length === 0) return [];

  const rows: LatestReleaseRow[] = [];
  const channelChunks = chunkStrings(channels, Math.max(1, Math.floor(D1_PARAM_LIMIT / 2)));
  for (const channelChunk of channelChunks) {
    const appChunkSize = Math.max(1, D1_PARAM_LIMIT - channelChunk.length);
    for (const appChunk of chunkStrings(appIds, appChunkSize)) {
      rows.push(
        ...(await db
          .select()
          .from(appLatestReleases)
          .where(
            and(
              inArray(appLatestReleases.appId, appChunk),
              inArray(appLatestReleases.channel, channelChunk),
            ),
          )
          .all()),
      );
    }
  }

  return rows;
}

async function selectAvailableChannelsByApp(
  db: ReturnType<typeof createDb>,
  appIds: string[],
): Promise<Map<string, string[]>> {
  const channelsByApp = new Map<string, Set<string>>();
  if (appIds.length === 0) return new Map();

  for (const appChunk of chunkStrings(appIds, Math.max(1, D1_PARAM_LIMIT))) {
    const rows = await db
      .selectDistinct({
        appId: appLatestReleases.appId,
        channel: appLatestReleases.channel,
      })
      .from(appLatestReleases)
      .where(inArray(appLatestReleases.appId, appChunk))
      .all();

    for (const row of rows) {
      const channels = channelsByApp.get(row.appId) ?? new Set<string>();
      channels.add(row.channel);
      channelsByApp.set(row.appId, channels);
    }
  }

  return new Map(
    [...channelsByApp].map(([appId, channels]) => [
      appId,
      [...channels].sort((a, b) => {
        if (a === "stable") return -1;
        if (b === "stable") return 1;
        return a.localeCompare(b);
      }),
    ]),
  );
}

async function selectLatestSourceSuccessByApp(
  db: ReturnType<typeof createDb>,
  appIds: string[],
): Promise<Map<string, string | null>> {
  const latestSourceSuccessByApp = new Map<string, string | null>();
  if (appIds.length === 0) return latestSourceSuccessByApp;

  for (const appChunk of chunkStrings(appIds, Math.max(1, D1_PARAM_LIMIT - 8))) {
    const rows = await db
      .select({ appId: sources.appId, lastSuccessAt: sources.lastSuccessAt })
      .from(sources)
      .where(
        and(
          inArray(sources.appId, appChunk),
          eq(sources.status, "active"),
          eq(sources.reviewStatus, "approved"),
          eq(sources.role, "authority"),
        ),
      )
      .all();

    for (const row of rows) {
      const existing = latestSourceSuccessByApp.get(row.appId);
      const rowTime = toEpochMs(row.lastSuccessAt);
      if (row.lastSuccessAt && rowTime === null) continue;
      const existingTime = toEpochMs(existing) ?? 0;
      if (!existing || (rowTime ?? 0) > existingTime) {
        latestSourceSuccessByApp.set(row.appId, row.lastSuccessAt);
      }
    }
  }

  return latestSourceSuccessByApp;
}

function buildLatestIndex(latestReleases: LatestReleaseRow[]): LatestByAppChannel {
  const latestByAppChannel: LatestByAppChannel = new Map();
  for (const latest of latestReleases) {
    let channelMap = latestByAppChannel.get(latest.appId);
    if (!channelMap) {
      channelMap = new Map();
      latestByAppChannel.set(latest.appId, channelMap);
    }

    let targetMap = channelMap.get(latest.channel);
    if (!targetMap) {
      targetMap = new Map();
      channelMap.set(latest.channel, targetMap);
    }
    targetMap.set(latest.targetArchitecture, latest);
  }
  return latestByAppChannel;
}

function latestRowsForRequestedChannel(
  latestByAppChannel: LatestByAppChannel,
  appId: string,
  requestedChannel: string,
): { channel: string; rows: Map<TargetArchitecture, LatestReleaseRow> } | null {
  const channelMap = latestByAppChannel.get(appId);
  if (!channelMap) return null;
  const requestedRows = channelMap.get(requestedChannel);
  if (requestedRows) return { channel: requestedChannel, rows: requestedRows };
  const stableRows = channelMap.get("stable");
  return stableRows ? { channel: "stable", rows: stableRows } : null;
}

function artifactForDecision(artifact: ArtifactRow | null | undefined): AppDecision["artifact"] {
  if (!artifact) return null;
  return {
    id: artifact.id,
    downloadUrl: artifact.url,
    architecture: artifact.architecture,
    minOsVersion: artifact.minOsVersion,
    artifactType: artifact.artifactType,
    sizeBytes: artifact.sizeBytes,
    sha256: artifact.sha256,
  };
}

function artifactRankForUnknownClient(architecture: string | null | undefined): number {
  const normalized = normalizeArtifactArchitecture(architecture);
  if (normalized === "universal") return 200;
  if (normalized === "unknown") return 100;
  return -1;
}

function latestRowIsUsableForClient(params: {
  latest: LatestReleaseRow;
  artifactById: ReadonlyMap<string, ArtifactRow>;
  targetArchitecture: TargetArchitecture | null;
  clientOs: string | undefined;
}): boolean {
  if (!params.latest.artifactId) return true;
  const artifact = params.artifactById.get(params.latest.artifactId);
  if (!artifact) return false;
  if (!isOsVersionCompatible(params.clientOs, artifact.minOsVersion)) return false;
  if (params.targetArchitecture) {
    return artifactSupportsTarget(artifact.architecture, params.targetArchitecture);
  }
  return artifactRankForUnknownClient(artifact.architecture) >= 0;
}

function selectUnknownArchitectureLatest(
  rows: ReadonlyMap<TargetArchitecture, LatestReleaseRow>,
  artifactById: ReadonlyMap<string, ArtifactRow>,
  clientOs: string | undefined,
): LatestReleaseRow | null {
  let best: { latest: LatestReleaseRow; rank: number } | null = null;
  for (const latest of rows.values()) {
    if (!latestRowIsUsableForClient({ latest, artifactById, targetArchitecture: null, clientOs })) {
      continue;
    }
    const artifact = latest.artifactId ? artifactById.get(latest.artifactId) : null;
    const rank = artifact ? artifactRankForUnknownClient(artifact.architecture) : 50;
    if (
      !best ||
      latest.versionNormalized > best.latest.versionNormalized ||
      (latest.versionNormalized === best.latest.versionNormalized && rank > best.rank)
    ) {
      best = { latest, rank };
    }
  }
  return best?.latest ?? null;
}

async function findCompatibleReleaseCandidate(params: {
  db: ReturnType<typeof createDb>;
  appId: string;
  channel: string;
  targetArchitecture: TargetArchitecture | null;
  clientOs: string | undefined;
}): Promise<CompatibleReleaseCandidate | null> {
  const rows = await params.db
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
      artifactCreatedAt: artifacts.createdAt,
      sourceType: sources.sourceType,
    })
    .from(releases)
    .innerJoin(artifacts, eq(artifacts.releaseId, releases.id))
    .leftJoin(sources, eq(sources.id, releases.publishedBySourceId))
    .where(
      and(
        eq(releases.appId, params.appId),
        eq(releases.status, "active"),
        eq(releases.channel, params.channel),
      ),
    )
    .orderBy(desc(releases.versionNormalized), desc(releases.createdAt))
    .limit(250)
    .all();

  let currentReleaseId: string | null = null;
  let bestForRelease: {
    row: (typeof rows)[number];
    rank: number;
  } | null = null;

  const flush = (): CompatibleReleaseCandidate | null => {
    if (!bestForRelease) return null;
    const row = bestForRelease.row;
    return {
      releaseId: row.releaseId,
      versionNormalized: row.versionNormalized,
      versionRaw: row.versionRaw,
      releasedAt: row.releasedAt,
      artifact: {
        id: row.artifactId,
        downloadUrl: row.artifactUrl,
        architecture: row.artifactArch,
        minOsVersion: row.artifactMinOs,
        artifactType: row.artifactType,
        sizeBytes: row.artifactSize,
        sha256: row.artifactSha256,
      },
      installStrategy: inferInstallStrategy(row.sourceType, row.artifactType),
    };
  };

  for (const row of rows) {
    if (currentReleaseId && row.releaseId !== currentReleaseId) {
      const candidate = flush();
      if (candidate) return candidate;
      bestForRelease = null;
    }
    currentReleaseId = row.releaseId;

    if (!isOsVersionCompatible(params.clientOs, row.artifactMinOs)) continue;
    const rank = params.targetArchitecture
      ? rankArtifactForTarget(row.artifactArch, params.targetArchitecture)
      : artifactRankForUnknownClient(row.artifactArch);
    if (rank < 0) continue;

    if (
      !bestForRelease ||
      rank > bestForRelease.rank ||
      (rank === bestForRelease.rank && row.artifactCreatedAt > bestForRelease.row.artifactCreatedAt)
    ) {
      bestForRelease = { row, rank };
    }
  }

  return flush();
}

export const inventoryRoutes = new Hono<InventoryEnv>()
  // POST /v1/inventory/check
  .post("/inventory/check", clientRateLimit, gzipJsonMiddleware, async (c) => {
    const request = c.get("inventoryRequest");
    const db = createDb(c.env.DB);
    const now = new Date().toISOString();

    const inventorySnapshot = await getInventoryMatchSnapshot({
      db,
      kv: c.env.CACHE_KV,
    });
    const appMap = new Map<string, InventoryAppInfo>(Object.entries(inventorySnapshot.appsById));
    const aliasRecords = inventorySnapshot.aliases;
    const caskTokenByApp = new Map(Object.entries(inventorySnapshot.caskTokenByAppId));
    const sparkleTrustAssertions = inventorySnapshot.sparkleTrustAssertions;
    const approvedSparkleTrustByApp = new Set(
      sparkleTrustAssertions.map((assertion) => assertion.appId),
    );

    // Extract channel preferences from client request
    const channelPrefs = request.client.channelPreferences;
    const defaultChannel = channelPrefs?.defaultChannel ?? "stable";
    const perAppChannels = channelPrefs?.perApp ?? {};
    const clientTargetArchitecture = normalizeTargetArchitecture(request.client.systemArchitecture);

    const matchPlans: InventoryMatchPlan[] = request.apps.map((installedApp) => {
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
      const appInfo = matchResult.appId ? appMap.get(matchResult.appId) : undefined;
      const isPublic = appInfo?.status === "public";
      return {
        installedApp,
        matchResult,
        appInfo,
        isPublic,
        requestedChannel: matchResult.appId
          ? (perAppChannels[matchResult.appId] ?? defaultChannel)
          : null,
      };
    });

    const publicMatchedAppIds = uniqueStrings(
      matchPlans.map((plan) =>
        plan.matchResult.matched &&
        !plan.matchResult.ambiguous &&
        plan.matchResult.appId &&
        plan.isPublic
          ? plan.matchResult.appId
          : null,
      ),
    );
    const requestedChannels = uniqueStrings([
      "stable",
      ...matchPlans.map((plan) =>
        plan.matchResult.matched &&
        !plan.matchResult.ambiguous &&
        plan.matchResult.appId &&
        plan.isPublic
          ? plan.requestedChannel
          : null,
      ),
    ]);

    const latestReleases = await selectLatestRowsForInventory(
      db,
      publicMatchedAppIds,
      requestedChannels,
    );
    const latestByAppChannel = buildLatestIndex(latestReleases);
    const availableChannelsByApp = await selectAvailableChannelsByApp(db, publicMatchedAppIds);
    const latestArtifactIds = uniqueStrings(latestReleases.map((latest) => latest.artifactId));
    const latestArtifactRows = await selectArtifactsByIds(db, latestArtifactIds);
    const latestArtifactById = new Map(
      latestArtifactRows.map((artifact) => [artifact.id, artifact]),
    );

    const latestSourceSuccessByApp = await selectLatestSourceSuccessByApp(db, publicMatchedAppIds);

    // Process each app
    const results: AppDecision[] = [];

    for (const { installedApp, matchResult, appInfo, isPublic, requestedChannel } of matchPlans) {
      let decision: AppDecision["decision"] = "local_only";
      let trackingState: AppDecision["trackingState"] = "local_only";
      let localReasonCode: AppDecision["localReasonCode"] = "not_found";
      let latestVersion: string | null = null;
      let latestVersionRaw: string | null = null;
      let latestVersionNormalized: string | null = null;
      let releasedAt: string | null = null;
      let latestReleaseId: string | null = null;
      let matchedArtifact: AppDecision["artifact"] = null;
      let resolvedInstallStrategy: InstallStrategy | null = null;
      let resolvedChannel: string | null = null;
      let staleSince: string | null = null;

      if (matchResult.matched && matchResult.appId && !matchResult.ambiguous) {
        if (!isPublic) {
          localReasonCode = appInfo?.status === "draft" ? "matched_draft" : "no_approved_source";
        } else {
          const selectedChannel = latestRowsForRequestedChannel(
            latestByAppChannel,
            matchResult.appId,
            requestedChannel ?? defaultChannel,
          );
          if (selectedChannel) {
            trackingState = "public";
            localReasonCode = null;

            const lastSuccess = latestSourceSuccessByApp.get(matchResult.appId) ?? null;
            staleSince = computeStaleSince(lastSuccess);
            const clientOs = request.client.osVersion;
            const latest = clientTargetArchitecture
              ? selectedChannel.rows.get(clientTargetArchitecture)
              : selectUnknownArchitectureLatest(selectedChannel.rows, latestArtifactById, clientOs);

            let compatibleCandidate: CompatibleReleaseCandidate | null = null;
            if (
              latest &&
              latestRowIsUsableForClient({
                latest,
                artifactById: latestArtifactById,
                targetArchitecture: clientTargetArchitecture,
                clientOs,
              })
            ) {
              const latestArtifact = latest.artifactId
                ? latestArtifactById.get(latest.artifactId)
                : null;
              compatibleCandidate = {
                releaseId: latest.releaseId,
                versionNormalized: latest.versionNormalized,
                versionRaw: latest.versionRaw,
                releasedAt: latest.releasedAt,
                artifact: artifactForDecision(latestArtifact),
                installStrategy: latest.installStrategy,
              };
              resolvedInstallStrategy = latest.installStrategy;
              resolvedChannel = latest.channel;
            } else if (latest) {
              compatibleCandidate = await findCompatibleReleaseCandidate({
                db,
                appId: matchResult.appId,
                channel: selectedChannel.channel,
                targetArchitecture: clientTargetArchitecture,
                clientOs,
              });
              resolvedInstallStrategy =
                compatibleCandidate?.installStrategy ?? latest.installStrategy;
              resolvedChannel = selectedChannel.channel;
            }

            if (compatibleCandidate) {
              latestVersion = displayVersion(compatibleCandidate.versionRaw);
              latestVersionRaw = compatibleCandidate.versionRaw;
              latestVersionNormalized = compatibleCandidate.versionNormalized;
              releasedAt = compatibleCandidate.releasedAt;
              latestReleaseId = compatibleCandidate.releaseId;
              matchedArtifact = compatibleCandidate.artifact;

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
              decision = "incompatible";
              localReasonCode = "no_compatible_release";
              resolvedChannel = selectedChannel.channel;
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
      const homebrewCaskToken = matchResult.appId
        ? (caskTokenByApp.get(matchResult.appId) ?? null)
        : null;
      const installTrust = deriveInstallTrust({
        decision,
        resolvedStrategy: resolvedInstallStrategy,
        artifact: matchedArtifact,
        targetArchitecture: clientTargetArchitecture,
        installedApp,
        homebrewCaskToken,
        hasApprovedSparklePublicKey: matchResult.appId
          ? approvedSparkleTrustByApp.has(matchResult.appId)
          : false,
      });
      const installStrategy =
        installTrust.status === "one_click" ? installTrust.resolvedStrategy : null;

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
        homebrewCaskToken,
        latestReleaseId,
        targetArchitecture: clientTargetArchitecture,
        channel: resolvedChannel,
        availableChannels: matchResult.appId
          ? (availableChannelsByApp.get(matchResult.appId) ?? [])
          : undefined,
        releasedAt,
        staleSince,
        iconUrl,
        artifact: matchedArtifact,
        installStrategy,
        installTrust,
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

    const followupPayload = buildInventoryFollowupPayload({
      requestApps: request.apps,
      resultsByLookupKey: resultByLookupKey,
      unmatchedByKey,
      persistedDiscoveries,
      processedAt: now,
    });
    await persistAndEnqueueInventoryFollowup({
      db,
      env: c.env,
      payload: followupPayload,
      now,
    });

    const skippedApps = c.get("skippedApps");
    captureApiEvent(c, "client_inventory_submitted", {
      target_type: "inventory",
      status: "processed",
      app_count: request.apps.length,
      skipped_count: skippedApps.length,
      result_count: results.length,
      update_available_count: results.filter((result) => result.decision === "update_available")
        .length,
      local_only_count: results.filter((result) => result.trackingState === "local_only").length,
      discovered_count: unmatchedByKey.size,
      followup_count: inventoryFollowupItemCount(followupPayload),
      scan_duration_ms: request.scanDurationMs ?? null,
    });
    return c.json({
      results,
      ...(skippedApps.length > 0 ? { skipped: skippedApps } : {}),
      processedAt: now,
    });
  });
