import { eq, and, desc, inArray, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";

import { telemetryRateLimit } from "@/middleware/rate-limit";
import { matchApp, normalizeAliasValue } from "@versioneer/core/identity";
import type { AliasRecord, TrustAssertionRecord } from "@versioneer/core/identity";
import { normalizeBaseUrl, resolveSourceUrl } from "@versioneer/core/sources";
import { installedAppSchema, inventoryRequestEnvelopeSchema } from "@versioneer/core/validation";
import type {
  AppDecision,
  InstallTrust,
  InstallTrustReason,
  InstalledApp,
  InventoryClient,
  SkippedApp,
} from "@versioneer/core/validation";
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
import {
  artifactCompatibilityIsKnown,
  artifactSupportsTarget,
  normalizeArtifactArchitecture,
  normalizeTargetArchitecture,
  rankArtifactForTarget,
  type TargetArchitecture,
} from "@versioneer/schemas/architecture";
import type { AliasType } from "@versioneer/schemas/catalog";
import type { InstallStrategy } from "@versioneer/schemas/releases";
import type { SourceType, SourceRole } from "@versioneer/schemas/sources";
import {
  defaultParserKeyForSourceType,
  defaultRoleForSourceType,
} from "@versioneer/schemas/sources";

import {
  D1_PARAM_LIMIT,
  MAX_INVENTORY_GZIP_BYTES,
  MAX_INVENTORY_GZIP_EXPANSION_RATIO,
  MAX_INVENTORY_JSON_BYTES,
} from "../lib/constants";
import { isOsVersionCompatible, computeStaleSince } from "./helpers";

function computeLookupKey(appName: string, bundleId?: string | null): string {
  if (bundleId) return `bid:${bundleId.toLowerCase()}`;
  return `name:${appName
    .toLowerCase()
    .trim()
    .replace(/\.app$/, "")}`;
}

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

type LatestReleaseRow = typeof appLatestReleases.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;
type LatestByAppChannel = Map<string, Map<string, Map<TargetArchitecture, LatestReleaseRow>>>;
type InventoryAppInfo = {
  canonicalName: string;
  iconR2Key: string | null;
  status: "draft" | "public" | "merged" | "deprecated" | "unlisted";
};
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

  if (
    (params.resolvedStrategy === "sparkle" ||
      params.resolvedStrategy === "zip_replace" ||
      params.resolvedStrategy === "dmg_copy_replace" ||
      params.resolvedStrategy === "pkg_install") &&
    params.artifact?.architecture &&
    !artifactCompatibilityIsKnown(params.artifact.architecture, params.targetArchitecture)
  ) {
    return {
      status: "manual_only",
      resolvedStrategy: params.resolvedStrategy,
      reasons: ["unknown_architecture"],
    };
  }

  if (params.resolvedStrategy === "sparkle") {
    if (params.installedApp.sparklePublicKey || params.hasApprovedSparklePublicKey) {
      return { status: "one_click", resolvedStrategy: params.resolvedStrategy, reasons: [] };
    }
    return {
      status: "manual_only",
      resolvedStrategy: params.resolvedStrategy,
      reasons: ["missing_sparkle_public_key"],
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
    return reasons.length === 0
      ? { status: "one_click", resolvedStrategy: params.resolvedStrategy, reasons: [] }
      : { status: "manual_only", resolvedStrategy: params.resolvedStrategy, reasons };
  }

  return {
    status: "manual_only",
    resolvedStrategy: params.resolvedStrategy,
    reasons: ["unsupported_strategy"],
  };
}

class RequestBodyTooLargeError extends Error {
  constructor(
    readonly maxBytes: number,
    readonly actualBytes: number,
  ) {
    super(`Request body exceeds ${maxBytes} bytes`);
  }
}

function parseContentLength(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function assertContentLengthWithinLimit(value: string | undefined, maxBytes: number) {
  const contentLength = parseContentLength(value);
  if (contentLength !== null && contentLength > maxBytes) {
    throw new RequestBodyTooLargeError(maxBytes, contentLength);
  }
}

async function readStreamBytesLimited(
  stream: ReadableStream<Uint8Array> | null,
  maxBytes: number,
): Promise<Uint8Array> {
  if (!stream) return new Uint8Array();

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let bytesRead = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      bytesRead += value.byteLength;
      if (bytesRead > maxBytes) {
        await reader.cancel();
        throw new RequestBodyTooLargeError(maxBytes, bytesRead);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(bytesRead);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function isGzipBody(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function readInventoryJson(request: Request): Promise<unknown> {
  const contentEncoding = request.headers.get("content-encoding")?.trim().toLowerCase();
  const contentLength = request.headers.get("content-length") ?? undefined;
  const decoder = new TextDecoder();

  if (!contentEncoding || contentEncoding === "identity") {
    assertContentLengthWithinLimit(contentLength, MAX_INVENTORY_JSON_BYTES);
    const bytes = await readStreamBytesLimited(request.body, MAX_INVENTORY_JSON_BYTES);
    return JSON.parse(decoder.decode(bytes)) as unknown;
  }

  if (contentEncoding !== "gzip") {
    throw new HTTPException(415, { message: "Unsupported content encoding" });
  }

  assertContentLengthWithinLimit(contentLength, MAX_INVENTORY_GZIP_BYTES);
  const compressed = await readStreamBytesLimited(request.body, MAX_INVENTORY_GZIP_BYTES);
  if (!isGzipBody(compressed)) {
    throw new Error("Invalid gzip body");
  }
  const decompressedStream = new Blob([compressed])
    .stream()
    .pipeThrough(new DecompressionStream("gzip"));
  const decoded = await readStreamBytesLimited(decompressedStream, MAX_INVENTORY_JSON_BYTES);
  const expansionRatio = decoded.byteLength / Math.max(compressed.byteLength, 1);
  if (expansionRatio > MAX_INVENTORY_GZIP_EXPANSION_RATIO) {
    throw new HTTPException(413, { message: "Compressed inventory body expands too much" });
  }
  return JSON.parse(decoder.decode(decoded)) as unknown;
}

async function selectDiscoveredAppsByLookupKeys(
  db: ReturnType<typeof createDb>,
  lookupKeys: string[],
) {
  const rows = [];
  for (let i = 0; i < lookupKeys.length; i += D1_PARAM_LIMIT) {
    const chunk = lookupKeys.slice(i, i + D1_PARAM_LIMIT);
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
      if (!existing || (row.lastSuccessAt && row.lastSuccessAt > existing)) {
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

function collectUnmatchedApps(
  installedApps: InstalledApp[],
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

  // D1 limits queries to 100 bound parameters, so lookup reads stay chunked.
  const allKeys = [...unmatchedByKey.keys()];
  const existingRows = await selectDiscoveredAppsByLookupKeys(db, allKeys);
  const existingByKey = new Map(existingRows.map((row) => [row.lookupKey, row] as const));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const writes: any[] = [];
  for (const [key, app] of unmatchedByKey) {
    const existing = existingByKey.get(key);
    const sampleVersions = JSON.stringify(
      nextSampleVersions(existing?.sampleVersions ?? null, app.version),
    );
    const newId = generateId(idPrefixes.discoveredApp);

    writes.push(
      db
        .insert(discoveredApps)
        .values({
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
        }),
    );
  }

  await db.batch(writes as [(typeof writes)[0], ...typeof writes]);

  const persistedRows = await selectDiscoveredAppsByLookupKeys(db, allKeys);
  for (const row of persistedRows) {
    persistedByKey.set(row.lookupKey, { id: row.id, iconR2Key: row.iconR2Key });
  }

  if (persistedByKey.size !== unmatchedByKey.size) {
    throw new Error("Discovered app batch did not persist every lookup key");
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
    const body = bytes.buffer;

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
  Variables: {
    inventoryRequest: {
      client: InventoryClient;
      apps: InstalledApp[];
      scanDurationMs?: number;
    };
    skippedApps: SkippedApp[];
  };
};

const gzipJsonMiddleware = createMiddleware<InventoryEnv>(async (c, next) => {
  let body: unknown;
  try {
    body = await readInventoryJson(c.req.raw);
  } catch (error) {
    if (error instanceof HTTPException) {
      throw error;
    }
    if (error instanceof RequestBodyTooLargeError) {
      throw new HTTPException(413, {
        res: Response.json(
          {
            error: "Request body too large",
            maxBytes: error.maxBytes,
            actualBytes: error.actualBytes,
          },
          { status: 413 },
        ),
      });
    }
    throw new HTTPException(400, { message: "Invalid JSON body" });
  }

  const envelope = inventoryRequestEnvelopeSchema.safeParse(body);
  if (!envelope.success) {
    throw new HTTPException(400, {
      res: Response.json(
        { error: "Invalid request", details: envelope.error.issues },
        { status: 400 },
      ),
    });
  }

  // Validate each app individually — skip invalid ones instead of rejecting the batch
  const validApps: InstalledApp[] = [];
  const skippedApps: SkippedApp[] = [];

  for (let i = 0; i < envelope.data.apps.length; i++) {
    const raw = envelope.data.apps[i];
    const parsed = installedAppSchema.safeParse(raw);
    if (parsed.success) {
      validApps.push(parsed.data);
    } else {
      const rawObj =
        typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : null;
      skippedApps.push({
        index: i,
        appName: typeof rawObj?.appName === "string" ? rawObj.appName : null,
        reasons: parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      });
    }
  }

  c.set("inventoryRequest", {
    client: envelope.data.client,
    apps: validApps,
    scanDurationMs: envelope.data.scanDurationMs,
  });
  c.set("skippedApps", skippedApps);
  await next();
});

export const inventoryRoutes = new Hono<InventoryEnv>()
  // POST /v1/inventory/check
  // TODO: Pre-compute inventory snapshot in KV, rebuilt on catalog changes, to avoid full-table loads
  .post("/inventory/check", telemetryRateLimit, gzipJsonMiddleware, async (c) => {
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
    const appMap = new Map<string, InventoryAppInfo>();
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

    const skippedApps = c.get("skippedApps");
    return c.json({
      results,
      ...(skippedApps.length > 0 ? { skipped: skippedApps } : {}),
      processedAt: now,
    });
  });
