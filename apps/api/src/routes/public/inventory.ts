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
  sources,
  clients,
  clientInventorySnapshots,
  clientInventoryApps,
  discoveredApps,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { inventoryCheckRequestSchema } from "@versioneer/validation";
import type { AppDecision } from "@versioneer/validation";
import { normalizeVersion } from "@versioneer/versioning";
import { compareVersionStrings } from "@versioneer/versioning";
import { eq, and, desc, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { HTTPException } from "hono/http-exception";
import type { z } from "zod";

import type { Env } from "../../env";
import { isArchCompatible, isOsVersionCompatible, computeStaleSince } from "./helpers";

function computeLookupKey(appName: string, bundleId?: string | null): string {
  if (bundleId) return `bid:${bundleId.toLowerCase()}`;
  return `name:${appName
    .toLowerCase()
    .trim()
    .replace(/\.app$/, "")}`;
}

/**
 * Decodes base64 icon data, hashes it, and stores it in R2.
 * Returns the R2 key or null on failure.
 */
async function storeIconToR2(
  bucket: R2Bucket,
  r2Prefix: string,
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

    const contentDigest = await crypto.subtle.digest("SHA-256", body);
    const contentHash = Array.from(new Uint8Array(contentDigest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, 12);

    const r2Key = `${r2Prefix}/${contentHash}.png`;

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

async function storeDiscoveredIcon(
  bucket: R2Bucket,
  lookupKey: string,
  iconBase64: string,
): Promise<string | null> {
  const keyBytes = new TextEncoder().encode(lookupKey);
  const keyDigest = await crypto.subtle.digest("SHA-256", keyBytes);
  const lookupKeyHash = Array.from(new Uint8Array(keyDigest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 16);
  return storeIconToR2(bucket, `discovered-icons/${lookupKeyHash}`, iconBase64);
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
  .post("/inventory/check", gzipJsonMiddleware, async (c) => {
    const request = c.get("inventoryRequest");
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

    // Load app details
    const appMap = new Map<
      string,
      { canonicalName: string; iconR2Key: string | null; isVerified: boolean }
    >();
    const allApps = await db
      .select({
        id: apps.id,
        canonicalName: apps.canonicalName,
        iconR2Key: apps.iconR2Key,
        isVerified: apps.isVerified,
      })
      .from(apps)
      .all();
    for (const a of allApps) {
      appMap.set(a.id, {
        canonicalName: a.canonicalName,
        iconR2Key: a.iconR2Key,
        isVerified: a.isVerified,
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

    // Load all latest releases, indexed by appId → channel → release
    const latestReleases = await db.select().from(appLatestReleases).all();
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
      .where(eq(sources.status, "active"))
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
        },
        aliasRecords,
      );

      let decision: AppDecision["decision"] = "not_tracked";
      let latestVersion: string | null = null;
      let latestVersionRaw: string | null = null;
      let releasedAt: string | null = null;
      let latestReleaseId: string | null = null;
      let matchedArtifact: AppDecision["artifact"] = null;
      let installStrategy: AppDecision["installStrategy"] = null;
      let resolvedChannel: string | null = null;
      let staleSince: string | null = null;

      const appInfo = matchResult.appId ? appMap.get(matchResult.appId) : undefined;
      const isVerified = appInfo?.isVerified ?? false;

      if (matchResult.matched && matchResult.appId) {
        if (!isVerified) {
          // Unverified apps are not tracked — no update info returned
          decision = "not_tracked";
        } else {
          const requestedChannel = perAppChannels[matchResult.appId] ?? defaultChannel;
          const channelMap = latestByAppChannel.get(matchResult.appId);
          const latest = channelMap
            ? (channelMap.get(requestedChannel) ?? channelMap.get("stable"))
            : undefined;
          if (latest) {
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
              latestVersion = latest.versionNormalized;
              latestVersionRaw = latest.versionRaw;
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
              decision = "not_tracked";
            }
          } else {
            decision = "not_tracked";
          }
        }
      }

      if (matchResult.ambiguous) {
        decision = "ambiguous";
      }

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
        isHomebrewInstalled: installedApp.isHomebrewInstalled ?? null,
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

      const iconUrl = appInfo?.iconR2Key ? `${c.env.ASSETS_BASE_URL}/${appInfo.iconR2Key}` : null;

      results.push({
        appName: installedApp.appName,
        bundleId: installedApp.bundleId ?? null,
        installedVersion: installedApp.version ?? null,
        matchedAppId: matchResult.appId,
        matchedAppName: matchResult.appName,
        matchConfidence: matchResult.confidence,
        decision,
        isVerified,
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
                configKv: c.env.CONFIG_KV,
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
                configKv: c.env.CONFIG_KV,
              });
            }
          }
        }

        // Backfill icons for matched catalog apps that are missing them
        for (const installedApp of request.apps) {
          if (!installedApp.iconBase64) continue;
          const result = results.find(
            (r) =>
              r.appName === installedApp.appName && r.bundleId === (installedApp.bundleId ?? null),
          );
          if (!result?.matchedAppId) continue;

          // Re-check from DB to avoid races with concurrent requests
          const appRow = await db
            .select({ id: apps.id, slug: apps.slug, iconR2Key: apps.iconR2Key })
            .from(apps)
            .where(eq(apps.id, result.matchedAppId))
            .get();
          if (!appRow || appRow.iconR2Key) continue;

          try {
            const iconKey = await storeIconToR2(
              c.env.ASSETS_BUCKET,
              `icons/${appRow.slug}`,
              installedApp.iconBase64,
            );
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
      })(),
    );

    return c.json({
      snapshotId,
      results,
      processedAt: now,
    });
  });
