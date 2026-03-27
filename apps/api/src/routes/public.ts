import { createDb } from "@versioneer/db";
import { matchApp, generateMatchExplanation } from "@versioneer/identity";
import type { AliasRecord } from "@versioneer/identity";
import { enrichDiscoveredApp, shouldEnrich } from "@versioneer/pipeline";
import {
  apps,
  appAliases,
  appLatestReleases,
  artifacts,
  releases,
  clients,
  clientInventorySnapshots,
  clientInventoryApps,
  clientFeedback,
  discoveredApps,
  installRules,
  reviewQueue,
  updateExecutions,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import {
  inventoryCheckRequestSchema,
  clientFeedbackSubmitSchema,
  installPrepareRequestSchema,
  installExecutionStatusUpdateSchema,
} from "@versioneer/validation";
import type { AppDecision } from "@versioneer/validation";
import { normalizeVersion } from "@versioneer/versioning";
import { compareVersionStrings } from "@versioneer/versioning";
import { eq, and, desc, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../env";

export const publicRoutes = new Hono<{ Bindings: Env }>();

/** Returns true if `current` >= `minimum` using numeric version comparison. */
function isOsVersionCompatible(
  current: string | null | undefined,
  minimum: string | null,
): boolean {
  if (!minimum) return true; // No minimum means compatible with any OS
  if (!current) return true; // Unknown client OS, assume compatible
  const curParts = current.split(".").map(Number);
  const minParts = minimum.split(".").map(Number);
  for (let i = 0; i < Math.max(curParts.length, minParts.length); i++) {
    const c = curParts[i] ?? 0;
    const m = minParts[i] ?? 0;
    if (c > m) return true;
    if (c < m) return false;
  }
  return true; // equal
}

/** Returns true if an artifact's architecture is compatible with the client's. */
function isArchCompatible(
  artifactArch: string | null,
  clientArch: string | null | undefined,
): boolean {
  if (!artifactArch) return true; // Unspecified artifact arch = universal/any
  if (!clientArch) return true; // Unknown client arch, assume compatible
  if (artifactArch === "universal") return true;
  return artifactArch === clientArch;
}

function computeLookupKey(appName: string, bundleId?: string | null): string {
  if (bundleId) return `bid:${bundleId.toLowerCase()}`;
  return `name:${appName
    .toLowerCase()
    .trim()
    .replace(/\.app$/, "")}`;
}

async function hashPath(path: string): Promise<string> {
  const bytes = new TextEncoder().encode(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function storeDiscoveredIcon(
  bucket: R2Bucket,
  lookupKey: string,
  iconBase64: string,
): Promise<string | null> {
  try {
    const binaryString = atob(iconBase64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i)!;
    }
    const body = bytes.buffer as ArrayBuffer;

    if (body.byteLength > 512 * 1024) return null;

    const keyBytes = new TextEncoder().encode(lookupKey);
    const keyDigest = await crypto.subtle.digest("SHA-256", keyBytes);
    const lookupKeyHash = Array.from(new Uint8Array(keyDigest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 16);

    const contentDigest = await crypto.subtle.digest("SHA-256", body);
    const contentHash = Array.from(new Uint8Array(contentDigest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);

    const r2Key = `discovered-icons/${lookupKeyHash}/${contentHash}.png`;

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

function deriveInstallabilityClass(params: {
  verificationTier: string | null;
  installRule: { strategy: string; enabled: boolean } | null;
  hasArtifact: boolean;
}): NonNullable<AppDecision["install"]["installabilityClass"]> {
  const { verificationTier, installRule, hasArtifact } = params;

  if (
    !installRule ||
    !installRule.enabled ||
    verificationTier === "unverified" ||
    !verificationTier
  ) {
    return "notify_only";
  }

  if (installRule.strategy === "manual_only" || installRule.strategy === "pkg_manual") {
    return "notify_only";
  }

  const strategyAvailable = installRule.strategy === "sparkle" || hasArtifact;
  if (!strategyAvailable) {
    return "notify_only";
  }

  if (verificationTier === "verified" && installRule.strategy === "sparkle") {
    return "automation_candidate";
  }

  if (verificationTier === "verified") {
    return "assisted_replace";
  }

  if (verificationTier === "provisional") {
    return "assisted_download";
  }

  return "notify_only";
}

function defaultInstallMetadata(
  eligibility: AppDecision["install"]["eligibility"] = "not_supported",
): AppDecision["install"] {
  return {
    canInstall: false,
    installabilityClass: null,
    strategy: null,
    requiresQuit: false,
    requiresAdmin: false,
    supportsSilent: false,
    eligibility,
  };
}

function buildInstallMetadata(params: {
  decision: AppDecision["decision"];
  installRule: {
    strategy: string;
    enabled: boolean;
    requiresQuit: boolean;
    requiresAdmin: boolean;
    supportsSilent: boolean;
  } | null;
  installabilityClass: AppDecision["install"]["installabilityClass"];
  verificationTier: string | null;
  isMasApp: boolean | null | undefined;
  hasSparkleFeed: boolean;
  hasArtifact: boolean;
}): AppDecision["install"] {
  const {
    decision,
    installRule,
    installabilityClass,
    verificationTier,
    isMasApp,
    hasSparkleFeed,
    hasArtifact,
  } = params;

  if (isMasApp) {
    return defaultInstallMetadata("mas_app");
  }

  if (!installRule) {
    return defaultInstallMetadata("not_supported");
  }

  const base: AppDecision["install"] = {
    canInstall: false,
    installabilityClass,
    strategy: installRule.strategy as AppDecision["install"]["strategy"],
    requiresQuit: installRule.requiresQuit,
    requiresAdmin: installRule.requiresAdmin,
    supportsSilent: installRule.supportsSilent,
    eligibility: "not_supported",
  };

  if (installRule.strategy === "manual_only" || installRule.strategy === "pkg_manual") {
    return { ...base, eligibility: "manual_only" };
  }

  if (
    decision !== "update_available" ||
    installabilityClass === null ||
    installabilityClass === "notify_only"
  ) {
    return base;
  }

  if (
    !verificationTier ||
    (verificationTier !== "verified" && verificationTier !== "provisional")
  ) {
    return base;
  }

  if (installRule.strategy === "sparkle" && !hasSparkleFeed) {
    return base;
  }

  if (installRule.strategy !== "sparkle" && !hasArtifact) {
    return base;
  }

  if (verificationTier === "provisional") {
    return { ...base, canInstall: true, eligibility: "requires_warning" };
  }

  return { ...base, canInstall: true, eligibility: "eligible" };
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

function actionTypeForStrategy(strategy: string): "sparkle" | "pkg_install" | "assisted_replace" {
  if (strategy === "sparkle") return "sparkle";
  if (strategy === "pkg_install") return "pkg_install";
  return "assisted_replace";
}

function artifactMatchesStrategy(
  strategy: string,
  artifactType: string | null,
  url: string,
): boolean {
  const lowerUrl = url.toLowerCase();

  switch (strategy) {
    case "zip_replace":
      return artifactType === "zip" || lowerUrl.endsWith(".zip");
    case "dmg_copy_replace":
      return artifactType === "dmg" || lowerUrl.endsWith(".dmg");
    case "pkg_install":
      return artifactType === "pkg" || lowerUrl.endsWith(".pkg");
    default:
      return true;
  }
}

// POST /v1/inventory/check
publicRoutes.post("/inventory/check", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }
  const parsed = inventoryCheckRequestSchema.safeParse(body);

  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const request = parsed.data;
  const db = createDb(c.env.DB);
  const now = new Date().toISOString();

  // Upsert client
  let client = await db
    .select()
    .from(clients)
    .where(eq(clients.anonymousInstallId, request.client.installId))
    .get();

  if (!client) {
    const clientId = generateId(idPrefixes.client);
    await db.insert(clients).values({
      id: clientId,
      anonymousInstallId: request.client.installId,
      platform: request.client.platform,
      appVersion: request.client.appVersion ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
    });
    client = {
      id: clientId,
      anonymousInstallId: request.client.installId,
      platform: request.client.platform,
      appVersion: request.client.appVersion ?? null,
      firstSeenAt: now,
      lastSeenAt: now,
    };
  } else {
    await db
      .update(clients)
      .set({ lastSeenAt: now, appVersion: request.client.appVersion ?? client.appVersion })
      .where(eq(clients.id, client.id));
  }

  // Create snapshot
  const snapshotId = generateId(idPrefixes.clientInventorySnapshot);
  await db.insert(clientInventorySnapshots).values({
    id: snapshotId,
    clientId: client.id,
    osVersion: request.client.osVersion ?? null,
    scanDurationMs: request.scanDurationMs ?? null,
    appCount: request.apps.length,
    createdAt: now,
  });

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
    .all();

  // Load app names for alias records
  const appMap = new Map<string, { canonicalName: string; iconR2Key: string | null }>();
  const allApps = await db
    .select({ id: apps.id, canonicalName: apps.canonicalName, iconR2Key: apps.iconR2Key })
    .from(apps)
    .all();
  for (const a of allApps) {
    appMap.set(a.id, { canonicalName: a.canonicalName, iconR2Key: a.iconR2Key });
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
  const expectedBundleIdByApp = pickPreferredAliasMap(allAliases, "bundle_id");
  const expectedTeamIdByApp = pickPreferredAliasMap(allAliases, "team_id");

  // Load all apps for verification tier lookup
  const allAppDetails = await db
    .select({ id: apps.id, verificationTier: apps.verificationTier })
    .from(apps)
    .all();
  const appVerificationMap = new Map<string, string>();
  for (const a of allAppDetails) {
    appVerificationMap.set(a.id, a.verificationTier);
  }

  // Load install rules, preferring enabled + most recently updated rule per app
  const allInstallRules = await db.select().from(installRules).all();
  allInstallRules.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const installRuleByApp = new Map<string, (typeof allInstallRules)[number]>();
  for (const rule of allInstallRules) {
    if (!installRuleByApp.has(rule.appId)) {
      installRuleByApp.set(rule.appId, rule);
    }
  }

  // Load all latest releases
  const latestReleases = await db.select().from(appLatestReleases).all();
  const latestByApp = new Map<string, (typeof latestReleases)[number]>();
  for (const lr of latestReleases) {
    // Prefer stable channel
    const key = lr.appId;
    const existing = latestByApp.get(key);
    if (!existing || lr.channel === "stable") {
      latestByApp.set(key, lr);
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
      },
      aliasRecords,
    );

    let decision: AppDecision["decision"] = "unknown";
    let latestVersion: string | null = null;
    let latestVersionRaw: string | null = null;
    let releasedAt: string | null = null;
    let latestReleaseId: string | null = null;
    let matchedArtifact: AppDecision["artifact"] = null;
    let selectedVerificationTier: string | null = null;
    let selectedInstallRule: {
      strategy: string;
      enabled: boolean;
      requiresQuit: boolean;
      requiresAdmin: boolean;
      supportsSilent: boolean;
    } | null = null;
    let selectedInstallabilityClass: AppDecision["install"]["installabilityClass"] = null;
    let installMetadata: AppDecision["install"] = defaultInstallMetadata(
      installedApp.isMasApp ? "mas_app" : "not_supported",
    );

    if (matchResult.matched && matchResult.appId) {
      // Publication gating: unverified apps return unsupported
      const tier = appVerificationMap.get(matchResult.appId);
      selectedVerificationTier = tier ?? null;
      if (tier === "unverified") {
        decision = "unsupported";
      }

      const latest =
        !tier || tier === "unverified" ? undefined : latestByApp.get(matchResult.appId);
      if (latest) {
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
          // Latest release is compatible (or has no artifacts to filter on)
          latestVersion = latest.versionNormalized;
          latestVersionRaw = latest.versionRaw;
          releasedAt = latest.releasedAt;
          latestReleaseId = latest.releaseId;

          if (compatibleArtifact) {
            matchedArtifact = {
              id: compatibleArtifact.id,
              downloadUrl: compatibleArtifact.url,
              architecture: compatibleArtifact.architecture,
              minOsVersion: compatibleArtifact.minOsVersion,
              artifactType: compatibleArtifact.artifactType,
              sizeBytes: compatibleArtifact.sizeBytes,
              sha256: compatibleArtifact.sha256,
              expectedTeamId:
                compatibleArtifact.expectedTeamId ??
                expectedTeamIdByApp.get(matchResult.appId) ??
                null,
              expectedBundleId: expectedBundleIdByApp.get(matchResult.appId) ?? null,
              expectedVersionRaw: latest.versionRaw,
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
              artifactExpectedTeamId: artifacts.expectedTeamId,
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
            .all();

          const found = olderCompatible.find(
            (r) =>
              isArchCompatible(r.artifactArch, clientArch) &&
              isOsVersionCompatible(clientOs, r.artifactMinOs),
          );

          if (found) {
            latestVersion = found.versionNormalized;
            latestVersionRaw = found.versionRaw;
            releasedAt = found.releasedAt;
            latestReleaseId = found.releaseId;
            matchedArtifact = {
              id: found.artifactId,
              downloadUrl: found.artifactUrl,
              architecture: found.artifactArch,
              minOsVersion: found.artifactMinOs,
              artifactType: found.artifactType,
              sizeBytes: found.artifactSize,
              sha256: found.artifactSha256,
              expectedTeamId:
                found.artifactExpectedTeamId ?? expectedTeamIdByApp.get(matchResult.appId) ?? null,
              expectedBundleId: expectedBundleIdByApp.get(matchResult.appId) ?? null,
              expectedVersionRaw: found.versionRaw,
            };
          }
        }

        const rawInstallRule = installRuleByApp.get(matchResult.appId) ?? null;
        selectedInstallRule = rawInstallRule
          ? {
              strategy: rawInstallRule.strategy,
              enabled: rawInstallRule.enabled,
              requiresQuit: rawInstallRule.requiresQuit,
              requiresAdmin: rawInstallRule.requiresAdmin,
              supportsSilent: rawInstallRule.supportsSilent,
            }
          : null;
        selectedInstallabilityClass =
          latest.installabilityClass ??
          deriveInstallabilityClass({
            verificationTier: tier ?? null,
            installRule: rawInstallRule
              ? { strategy: rawInstallRule.strategy, enabled: rawInstallRule.enabled }
              : null,
            hasArtifact: matchedArtifact?.downloadUrl != null,
          });

        if (latestVersion) {
          if (installedApp.version) {
            const installedNormalized = normalizeVersion(installedApp.version);
            const cmp = compareVersionStrings(installedNormalized, latestVersion);
            if (cmp >= 0) {
              decision = "up_to_date";
            } else {
              decision = "update_available";
            }
          } else {
            decision = "ambiguous";
          }
        } else {
          decision = "unsupported";
        }
      } else {
        decision = "unsupported";
      }
    }

    if (matchResult.ambiguous) {
      decision = "ambiguous";
    }

    installMetadata = buildInstallMetadata({
      decision,
      installRule: selectedInstallRule,
      installabilityClass: selectedInstallabilityClass,
      verificationTier: selectedVerificationTier,
      isMasApp: installedApp.isMasApp,
      hasSparkleFeed: Boolean(installedApp.sparkleFeedUrl),
      hasArtifact: matchedArtifact?.downloadUrl != null,
    });

    // Generate match explanation
    const matchExplanation = generateMatchExplanation(
      {
        appName: installedApp.appName,
        bundleId: installedApp.bundleId,
        teamId: installedApp.teamId,
        version: installedApp.version,
      },
      matchResult,
      aliasRecords,
    );

    // Store inventory app record
    const ciaId = generateId(idPrefixes.clientInventoryApp);
    await db.insert(clientInventoryApps).values({
      id: ciaId,
      snapshotId,
      appName: installedApp.appName,
      bundleId: installedApp.bundleId ?? null,
      installedVersionRaw: installedApp.version ?? null,
      installedVersionNormalized: installedApp.version
        ? normalizeVersion(installedApp.version)
        : null,
      buildNumber: installedApp.buildNumber ?? null,
      teamId: installedApp.teamId ?? null,
      pathHash: installedApp.pathHash ?? null,
      architecture: installedApp.architecture ?? null,
      sparkleFeedUrl: installedApp.sparkleFeedUrl ?? null,
      isMasApp: installedApp.isMasApp ?? null,
      electronUpdateUrl: installedApp.electronUpdateUrl ?? null,
      matchedAppId: matchResult.appId,
      matchMethod: matchResult.method,
      matchConfidence: matchResult.confidence,
      decisionStatus: decision,
      latestReleaseId,
      latestVersionNormalized: latestVersion,
      latestVersionRaw,
      matchExplanationJson: JSON.stringify(matchExplanation),
      createdAt: now,
    });

    const matchedAppInfo = matchResult.appId ? appMap.get(matchResult.appId) : undefined;
    const iconUrl = matchedAppInfo?.iconR2Key
      ? `${c.env.ASSETS_BASE_URL}/${matchedAppInfo.iconR2Key}`
      : null;

    results.push({
      appName: installedApp.appName,
      bundleId: installedApp.bundleId ?? null,
      installedVersion: installedApp.version ?? null,
      matchedAppId: matchResult.appId,
      matchedAppName: matchResult.appName,
      matchConfidence: matchResult.confidence,
      decision,
      latestVersion,
      latestVersionRaw,
      latestReleaseId,
      releasedAt,
      iconUrl,
      artifact: matchedArtifact,
      install: installMetadata,
    });
  }

  // Track unmatched apps as discovered apps (runs after response)
  c.executionCtx.waitUntil(
    (async () => {
      // Collect unmatched apps, deduplicate by lookupKey within this batch
      const unmatchedByKey = new Map<
        string,
        {
          appName: string;
          bundleId?: string | null;
          teamId?: string | null;
          version?: string | null;
          sparkleFeedUrl?: string | null;
          isMasApp?: boolean | null;
          electronUpdateUrl?: string | null;
          codeSigningAuthority?: string | null;
          appCategory?: string | null;
          minMacOSVersion?: string | null;
          iconBase64?: string | null;
        }
      >();
      for (const installedApp of request.apps) {
        const result = results.find(
          (r) =>
            r.appName === installedApp.appName && r.bundleId === (installedApp.bundleId ?? null),
        );
        if (result && result.matchedAppId !== null) continue;

        const key = computeLookupKey(installedApp.appName, installedApp.bundleId);
        if (!unmatchedByKey.has(key)) {
          unmatchedByKey.set(key, {
            appName: installedApp.appName,
            bundleId: installedApp.bundleId,
            teamId: installedApp.teamId,
            version: installedApp.version,
            sparkleFeedUrl: installedApp.sparkleFeedUrl,
            isMasApp: installedApp.isMasApp,
            electronUpdateUrl: installedApp.electronUpdateUrl,
            codeSigningAuthority: installedApp.codeSigningAuthority,
            appCategory: installedApp.appCategory,
            minMacOSVersion: installedApp.minMacOSVersion,
            iconBase64: installedApp.iconBase64,
          });
        }
      }

      if (unmatchedByKey.size === 0) return;

      for (const [key, app] of unmatchedByKey) {
        const existing = await db
          .select()
          .from(discoveredApps)
          .where(eq(discoveredApps.lookupKey, key))
          .get();

        if (existing) {
          // Update sighting count and metadata
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
              isMasApp: app.isMasApp ?? existing.isMasApp,
              electronUpdateUrl: app.electronUpdateUrl ?? existing.electronUpdateUrl,
              codeSigningAuthority: app.codeSigningAuthority ?? existing.codeSigningAuthority,
              appCategory: app.appCategory ?? existing.appCategory,
              minMacOSVersion: app.minMacOSVersion ?? existing.minMacOSVersion,
            })
            .where(eq(discoveredApps.id, existing.id));

          // Store icon if not yet present
          if (!existing.iconR2Key && app.iconBase64) {
            const iconKey = await storeDiscoveredIcon(c.env.ASSETS_BUCKET, key, app.iconBase64);
            if (iconKey) {
              await db
                .update(discoveredApps)
                .set({ iconR2Key: iconKey })
                .where(eq(discoveredApps.id, existing.id));
            }
          }

          // Enrich if stale or never enriched
          if (shouldEnrich(existing)) {
            await enrichDiscoveredApp({
              discoveredAppId: existing.id,
              db,
              githubToken: c.env.GITHUB_TOKEN,
              assetsBucket: c.env.ASSETS_BUCKET,
            });
          }
        } else {
          const sampleVersions = app.version ? [app.version] : [];
          const initialStatus = app.isMasApp ? "mas_app" : "pending";
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
            status: initialStatus,
            sampleVersions: JSON.stringify(sampleVersions),
            sparkleFeedUrl: app.sparkleFeedUrl ?? null,
            isMasApp: app.isMasApp ?? null,
            electronUpdateUrl: app.electronUpdateUrl ?? null,
            codeSigningAuthority: app.codeSigningAuthority ?? null,
            appCategory: app.appCategory ?? null,
            minMacOSVersion: app.minMacOSVersion ?? null,
            createdAt: now,
            updatedAt: now,
          });

          // Store icon if provided
          if (app.iconBase64) {
            const iconKey = await storeDiscoveredIcon(c.env.ASSETS_BUCKET, key, app.iconBase64);
            if (iconKey) {
              await db
                .update(discoveredApps)
                .set({ iconR2Key: iconKey })
                .where(eq(discoveredApps.id, newId));
            }
          }

          // Enrich newly discovered app if it has a feed URL
          if (app.sparkleFeedUrl || app.electronUpdateUrl) {
            await enrichDiscoveredApp({
              discoveredAppId: newId,
              db,
              githubToken: c.env.GITHUB_TOKEN,
              assetsBucket: c.env.ASSETS_BUCKET,
            });
          }
        }
      }
    })(),
  );

  return c.json({
    snapshotId,
    results,
    processedAt: now,
  });
});

// POST /v1/install/prepare
publicRoutes.post("/install/prepare", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = installPrepareRequestSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DB);
  const now = new Date().toISOString();
  const data = parsed.data;
  const localPathHash = await hashPath(data.localAppPath);

  const client = await db
    .select()
    .from(clients)
    .where(eq(clients.anonymousInstallId, data.installId))
    .get();
  if (!client) {
    return c.json({ error: "Unknown client. Submit inventory first." }, 400);
  }

  const snapshot = await db
    .select()
    .from(clientInventorySnapshots)
    .where(
      and(
        eq(clientInventorySnapshots.id, data.snapshotId),
        eq(clientInventorySnapshots.clientId, client.id),
      ),
    )
    .get();
  if (!snapshot) {
    return c.json({ error: "Snapshot not found for client" }, 404);
  }

  const inventoryApp = await db
    .select()
    .from(clientInventoryApps)
    .where(
      and(
        eq(clientInventoryApps.snapshotId, data.snapshotId),
        eq(clientInventoryApps.matchedAppId, data.matchedAppId),
        eq(clientInventoryApps.latestReleaseId, data.releaseId),
        eq(clientInventoryApps.pathHash, localPathHash),
      ),
    )
    .get();
  if (!inventoryApp) {
    return c.json({ error: "No matching inventory record for requested install" }, 404);
  }

  if (inventoryApp.isMasApp) {
    return c.json({ error: "Mac App Store apps cannot be installed by Versioneer" }, 400);
  }

  if (inventoryApp.decisionStatus !== "update_available") {
    return c.json({ error: "App is not currently eligible for install" }, 400);
  }

  const app = await db.select().from(apps).where(eq(apps.id, data.matchedAppId)).get();
  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  if (app.verificationTier !== "verified" && app.verificationTier !== "provisional") {
    return c.json({ error: "App verification tier does not permit installation" }, 400);
  }

  const release = await db
    .select()
    .from(releases)
    .where(and(eq(releases.id, data.releaseId), eq(releases.appId, data.matchedAppId)))
    .get();
  if (!release || release.status !== "active") {
    return c.json({ error: "Release not found or inactive" }, 404);
  }

  const appInstallRules = await db
    .select()
    .from(installRules)
    .where(eq(installRules.appId, data.matchedAppId))
    .all();
  appInstallRules.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  const selectedRule = appInstallRules[0] ?? null;
  if (!selectedRule || !selectedRule.enabled) {
    return c.json({ error: "No enabled install rule found for app" }, 400);
  }

  if (selectedRule.strategy !== data.strategyCandidate) {
    return c.json({ error: "Requested strategy does not match the active install rule" }, 400);
  }

  if (selectedRule.strategy === "manual_only" || selectedRule.strategy === "pkg_manual") {
    return c.json({ error: "Selected install rule is manual-only" }, 400);
  }

  const exactAliases = await db
    .select({
      aliasType: appAliases.aliasType,
      value: appAliases.value,
      confidenceWeight: appAliases.confidenceWeight,
    })
    .from(appAliases)
    .where(
      and(
        eq(appAliases.appId, data.matchedAppId),
        eq(appAliases.isActive, true),
        eq(appAliases.isExact, true),
      ),
    )
    .all();
  const expectedBundleId =
    exactAliases
      .filter((alias) => alias.aliasType === "bundle_id")
      .sort((a, b) => b.confidenceWeight - a.confidenceWeight)[0]?.value ?? null;
  const expectedTeamId =
    exactAliases
      .filter((alias) => alias.aliasType === "team_id")
      .sort((a, b) => b.confidenceWeight - a.confidenceWeight)[0]?.value ?? null;

  let artifactPlan: AppDecision["artifact"] = null;
  if (selectedRule.strategy === "sparkle") {
    if (!inventoryApp.sparkleFeedUrl) {
      return c.json({ error: "Latest inventory snapshot does not include Sparkle metadata" }, 400);
    }
  } else {
    const releaseArtifacts = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.releaseId, data.releaseId))
      .all();
    const compatibleArtifact = releaseArtifacts.find(
      (artifact) =>
        isArchCompatible(artifact.architecture, inventoryApp.architecture) &&
        isOsVersionCompatible(snapshot.osVersion, artifact.minOsVersion) &&
        artifactMatchesStrategy(selectedRule.strategy, artifact.artifactType, artifact.url),
    );

    if (!compatibleArtifact) {
      return c.json({ error: "No compatible artifact is available for this install rule" }, 400);
    }

    artifactPlan = {
      id: compatibleArtifact.id,
      downloadUrl: compatibleArtifact.url,
      architecture: compatibleArtifact.architecture,
      minOsVersion: compatibleArtifact.minOsVersion,
      artifactType: compatibleArtifact.artifactType,
      sizeBytes: compatibleArtifact.sizeBytes,
      sha256: compatibleArtifact.sha256,
      expectedTeamId: compatibleArtifact.expectedTeamId ?? expectedTeamId,
      expectedBundleId,
      expectedVersionRaw: release.versionRaw,
    };
  }

  const installabilityClass = deriveInstallabilityClass({
    verificationTier: app.verificationTier,
    installRule: { strategy: selectedRule.strategy, enabled: selectedRule.enabled },
    hasArtifact: artifactPlan?.downloadUrl != null,
  });
  if (installabilityClass === "notify_only") {
    return c.json({ error: "Installability class does not permit installation" }, 400);
  }

  const executionId = generateId(idPrefixes.updateExecution);
  await db.insert(updateExecutions).values({
    id: executionId,
    clientId: client.id,
    appId: data.matchedAppId,
    releaseId: data.releaseId,
    artifactId: artifactPlan?.id ?? null,
    actionType: actionTypeForStrategy(selectedRule.strategy),
    actionStatus: "initiated",
    clientVersionBefore: data.installedVersion ?? inventoryApp.installedVersionRaw ?? null,
    clientVersionAfter: null,
    installabilityClass,
    errorMessage: null,
    detailsJson: JSON.stringify({
      snapshotId: data.snapshotId,
      strategy: selectedRule.strategy,
      warningLevel: app.verificationTier === "provisional" ? "provisional" : "none",
      localAppPath: data.localAppPath,
    }),
    durationMs: null,
    initiatedAt: now,
    completedAt: null,
  });

  return c.json({
    executionId,
    plan: {
      executionId,
      appId: data.matchedAppId,
      releaseId: data.releaseId,
      strategy: selectedRule.strategy,
      installabilityClass,
      warningLevel: app.verificationTier === "provisional" ? "provisional" : "none",
      requiresQuit: selectedRule.requiresQuit,
      requiresAdmin: selectedRule.requiresAdmin,
      supportsSilent: selectedRule.supportsSilent,
      relaunchAfterInstall: selectedRule.strategy !== "pkg_install",
      artifact: artifactPlan,
      localVerification: {
        requireHash: artifactPlan?.sha256 != null,
        requireSignature: selectedRule.strategy !== "sparkle",
        requireNotarization: selectedRule.strategy !== "sparkle",
        requireBundleIdMatch:
          selectedRule.strategy !== "pkg_install" && artifactPlan?.expectedBundleId != null,
        requireTeamIdMatch: artifactPlan?.expectedTeamId != null,
        requireVersionMatch:
          selectedRule.strategy !== "pkg_install" && artifactPlan?.expectedVersionRaw != null,
      },
    },
  });
});

// POST /v1/install/executions/:executionId/status
publicRoutes.post("/install/executions/:executionId/status", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = installExecutionStatusUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DB);
  const executionId = c.req.param("executionId");
  const data = parsed.data;

  const client = await db
    .select()
    .from(clients)
    .where(eq(clients.anonymousInstallId, data.installId))
    .get();
  if (!client) {
    return c.json({ error: "Unknown client" }, 400);
  }

  const execution = await db
    .select()
    .from(updateExecutions)
    .where(and(eq(updateExecutions.id, executionId), eq(updateExecutions.clientId, client.id)))
    .get();
  if (!execution) {
    return c.json({ error: "Execution not found for client" }, 404);
  }

  const terminal =
    data.actionStatus === "completed" ||
    data.actionStatus === "failed" ||
    data.actionStatus === "cancelled";

  await db
    .update(updateExecutions)
    .set({
      actionStatus: data.actionStatus,
      clientVersionAfter: data.clientVersionAfter ?? execution.clientVersionAfter,
      errorMessage: data.errorMessage ?? null,
      detailsJson: data.detailsJson ?? execution.detailsJson,
      durationMs: data.durationMs ?? execution.durationMs,
      completedAt: terminal ? new Date().toISOString() : execution.completedAt,
    })
    .where(eq(updateExecutions.id, executionId));

  return c.json({ executionId, status: data.actionStatus });
});

// GET /v1/apps/:appId
publicRoutes.get("/apps/:appId", async (c) => {
  const appId = c.req.param("appId");
  const db = createDb(c.env.DB);

  const app = await db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) {
    return c.json({ error: "App not found" }, 404);
  }

  const iconUrl = app.iconR2Key ? `${c.env.ASSETS_BASE_URL}/${app.iconR2Key}` : null;
  return c.json({ ...app, iconUrl });
});

// GET /v1/apps/:appId/releases
publicRoutes.get("/apps/:appId/releases", async (c) => {
  const appId = c.req.param("appId");
  const db = createDb(c.env.DB);

  const appReleases = await db.select().from(releases).where(eq(releases.appId, appId)).all();

  return c.json({ releases: appReleases });
});

// GET /v1/releases/:releaseId/notes
publicRoutes.get("/releases/:releaseId/notes", async (c) => {
  const releaseId = c.req.param("releaseId");
  const db = createDb(c.env.DB);

  const release = await db
    .select({
      id: releases.id,
      appId: releases.appId,
      versionRaw: releases.versionRaw,
      releaseNotesHtml: releases.releaseNotesHtml,
    })
    .from(releases)
    .where(eq(releases.id, releaseId))
    .get();

  if (!release) {
    return c.json({ error: "Release not found" }, 404);
  }

  return c.json({
    releaseId: release.id,
    appId: release.appId,
    versionRaw: release.versionRaw,
    releaseNotesHtml: release.releaseNotesHtml,
  });
});

// POST /v1/feedback
publicRoutes.post("/feedback", async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON body" }, 400);
  }

  const parsed = clientFeedbackSubmitSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "Invalid request", details: parsed.error.issues }, 400);
  }

  const db = createDb(c.env.DB);
  const now = new Date().toISOString();

  // Look up client
  const client = await db
    .select()
    .from(clients)
    .where(eq(clients.anonymousInstallId, parsed.data.installId))
    .get();

  if (!client) {
    return c.json({ error: "Unknown client. Submit inventory first." }, 400);
  }

  const feedbackId = generateId(idPrefixes.feedback);
  const targetAppId = parsed.data.matchedAppId ?? null;

  // Determine priority by type
  const priorityMap: Record<string, number> = {
    wrong_match: 2,
    wrong_version: 1,
    app_request: 1,
    general: 0,
  };

  // Create review queue item
  const rqId = generateId(idPrefixes.reviewQueue);
  await db.insert(reviewQueue).values({
    id: rqId,
    reviewType: `client_feedback:${parsed.data.feedbackType}`,
    relatedId: feedbackId,
    payloadJson: JSON.stringify({
      feedbackType: parsed.data.feedbackType,
      appName: parsed.data.appName,
      bundleId: parsed.data.bundleId,
      targetAppId,
    }),
    priority: priorityMap[parsed.data.feedbackType] ?? 0,
    status: "pending",
    createdAt: now,
  });

  // Insert feedback record
  await db.insert(clientFeedback).values({
    id: feedbackId,
    clientId: client.id,
    snapshotId: parsed.data.snapshotId ?? null,
    inventoryAppId: parsed.data.inventoryAppId ?? null,
    feedbackType: parsed.data.feedbackType,
    targetAppId,
    bundleId: parsed.data.bundleId ?? null,
    appName: parsed.data.appName ?? null,
    payloadJson: parsed.data.payload ? JSON.stringify(parsed.data.payload) : null,
    status: "new",
    reviewQueueItemId: rqId,
    createdAt: now,
  });

  return c.json({ id: feedbackId, status: "received" });
});
