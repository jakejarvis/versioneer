import { createDb } from "@versioneer/db";
import { matchApp } from "@versioneer/identity";
import type { AliasRecord } from "@versioneer/identity";
import {
  apps,
  appAliases,
  appLatestReleases,
  releases,
  clients,
  clientInventorySnapshots,
  clientInventoryApps,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { inventoryCheckRequestSchema } from "@versioneer/validation";
import type { AppDecision } from "@versioneer/validation";
import { normalizeVersion } from "@versioneer/versioning";
import { compareVersionStrings } from "@versioneer/versioning";
import { eq } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../env";

export const publicRoutes = new Hono<{ Bindings: Env }>();

// POST /v1/inventory/check
publicRoutes.post("/inventory/check", async (c) => {
  const body = await c.req.json();
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
  const appMap = new Map<string, string>();
  const allApps = await db
    .select({ id: apps.id, canonicalName: apps.canonicalName })
    .from(apps)
    .all();
  for (const a of allApps) {
    appMap.set(a.id, a.canonicalName);
  }

  const aliasRecords: AliasRecord[] = allAliases.map((a) => ({
    appId: a.appId,
    appName: appMap.get(a.appId) ?? "Unknown",
    aliasType: a.aliasType,
    value: a.value,
    normalizedValue: a.normalizedValue,
    isExact: a.isExact,
    confidenceWeight: a.confidenceWeight,
  }));

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
      const latest = latestByApp.get(matchResult.appId);
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
      matchedAppId: matchResult.appId,
      matchMethod: matchResult.method,
      matchConfidence: matchResult.confidence,
      decisionStatus: decision,
      latestReleaseId,
      latestVersionNormalized: latestVersion,
      latestVersionRaw,
      createdAt: now,
    });

    results.push({
      appName: installedApp.appName,
      bundleId: installedApp.bundleId ?? null,
      installedVersion: installedApp.version ?? null,
      matchedAppId: matchResult.appId,
      matchedAppName: matchResult.appName,
      matchConfidence: matchResult.confidence,
      decision,
      latestVersion: latestVersionRaw,
      latestVersionRaw,
      releasedAt,
    });
  }

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

  return c.json(app);
});

// GET /v1/apps/:appId/releases
publicRoutes.get("/apps/:appId/releases", async (c) => {
  const appId = c.req.param("appId");
  const db = createDb(c.env.DB);

  const appReleases = await db.select().from(releases).where(eq(releases.appId, appId)).all();

  return c.json({ releases: appReleases });
});
