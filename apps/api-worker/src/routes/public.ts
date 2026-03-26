import { createDb } from "@versioneer/db";
import { matchApp, generateMatchExplanation } from "@versioneer/identity";
import type { AliasRecord } from "@versioneer/identity";
import {
  apps,
  appAliases,
  appLatestReleases,
  releases,
  clients,
  clientInventorySnapshots,
  clientInventoryApps,
  clientFeedback,
  discoveredApps,
  reviewQueue,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { inventoryCheckRequestSchema, clientFeedbackSubmitSchema } from "@versioneer/validation";
import type { AppDecision } from "@versioneer/validation";
import { normalizeVersion } from "@versioneer/versioning";
import { compareVersionStrings } from "@versioneer/versioning";
import { eq, sql } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../env";

export const publicRoutes = new Hono<{ Bindings: Env }>();

function computeLookupKey(appName: string, bundleId?: string | null): string {
  if (bundleId) return `bid:${bundleId.toLowerCase()}`;
  return `name:${appName
    .toLowerCase()
    .trim()
    .replace(/\.app$/, "")}`;
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

  // Load all apps for verification tier lookup
  const allAppDetails = await db
    .select({ id: apps.id, verificationTier: apps.verificationTier })
    .from(apps)
    .all();
  const appVerificationMap = new Map<string, string>();
  for (const a of allAppDetails) {
    appVerificationMap.set(a.id, a.verificationTier);
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

    if (matchResult.matched && matchResult.appId) {
      // Publication gating: unverified apps return unsupported
      const tier = appVerificationMap.get(matchResult.appId);
      if (tier === "unverified") {
        decision = "unsupported";
      }

      const latest =
        !tier || tier === "unverified" ? undefined : latestByApp.get(matchResult.appId);
      if (latest) {
        latestVersion = latest.versionNormalized;
        latestVersionRaw = latest.versionRaw;
        releasedAt = latest.releasedAt;
        latestReleaseId = latest.releaseId;

        if (installedApp.version) {
          const installedNormalized = normalizeVersion(installedApp.version);
          const cmp = compareVersionStrings(installedNormalized, latest.versionNormalized);
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
      releasedAt,
      iconUrl,
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
            })
            .where(eq(discoveredApps.id, existing.id));
        } else {
          const sampleVersions = app.version ? [app.version] : [];
          await db.insert(discoveredApps).values({
            id: generateId(idPrefixes.discoveredApp),
            lookupKey: key,
            appName: app.appName,
            bundleId: app.bundleId ?? null,
            teamId: app.teamId ?? null,
            sightingCount: 1,
            firstSeenAt: now,
            lastSeenAt: now,
            status: "pending",
            sampleVersions: JSON.stringify(sampleVersions),
            sparkleFeedUrl: app.sparkleFeedUrl ?? null,
            isMasApp: app.isMasApp ?? null,
            electronUpdateUrl: app.electronUpdateUrl ?? null,
            createdAt: now,
            updatedAt: now,
          });
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
