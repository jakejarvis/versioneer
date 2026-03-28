import { zValidator } from "@hono/zod-validator";
import { createDb } from "@versioneer/db";
import {
  apps,
  artifacts,
  releases,
  appLatestReleases,
  clients,
  clientInventorySnapshots,
  clientInventoryApps,
  updateExecutions,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import {
  installPrepareRequestSchema,
  installExecutionStatusUpdateSchema,
} from "@versioneer/validation";
import { eq, and } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { Env } from "../../env";
import { isArchCompatible, isOsVersionCompatible } from "./helpers";

async function hashPath(path: string): Promise<string> {
  const bytes = new TextEncoder().encode(path);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
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

export const installRoutes = new Hono<{ Bindings: Env }>()
  // POST /v1/install/prepare
  .post(
    "/install/prepare",
    zValidator("json", installPrepareRequestSchema, (result) => {
      if (!result.success) {
        throw new HTTPException(400, {
          res: Response.json(
            { error: "Invalid request", details: result.error.issues },
            { status: 400 },
          ),
        });
      }
    }),
    async (c) => {
      const db = createDb(c.env.DB);
      const now = new Date().toISOString();
      const data = c.req.valid("json");
      const localPathHash = await hashPath(data.localAppPath);

      const client = await db
        .select()
        .from(clients)
        .where(eq(clients.anonymousInstallId, data.installId))
        .get();
      if (!client) {
        throw new HTTPException(400, { message: "Unknown client. Submit inventory first." });
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
        throw new HTTPException(404, { message: "Snapshot not found for client" });
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
        throw new HTTPException(404, {
          message: "No matching inventory record for requested install",
        });
      }

      if (inventoryApp.isMasApp) {
        throw new HTTPException(400, {
          message: "Mac App Store apps cannot be installed by Versioneer",
        });
      }

      if (inventoryApp.decisionStatus !== "update_available") {
        throw new HTTPException(400, { message: "App is not currently eligible for install" });
      }

      const app = await db.select().from(apps).where(eq(apps.id, data.matchedAppId)).get();
      if (!app) {
        throw new HTTPException(404, { message: "App not found" });
      }

      if (!app.isVerified) {
        throw new HTTPException(400, {
          message: "App is not verified and cannot be installed",
        });
      }

      const release = await db
        .select()
        .from(releases)
        .where(and(eq(releases.id, data.releaseId), eq(releases.appId, data.matchedAppId)))
        .get();
      if (!release || release.status !== "active") {
        throw new HTTPException(404, { message: "Release not found or inactive" });
      }

      // Get the latest release record for install strategy
      const latestRelease = await db
        .select()
        .from(appLatestReleases)
        .where(eq(appLatestReleases.appId, data.matchedAppId))
        .get();
      const strategy = data.strategyCandidate;

      if (strategy === "manual_only") {
        throw new HTTPException(400, { message: "Manual-only strategy cannot be installed" });
      }

      let artifactPlan: {
        id: string;
        downloadUrl: string;
        architecture: string | null;
        minOsVersion: string | null;
        artifactType: string;
        sizeBytes: number | null;
        sha256: string | null;
      } | null = null;

      if (strategy === "sparkle") {
        if (!inventoryApp.sparkleFeedUrl) {
          throw new HTTPException(400, {
            message: "Latest inventory snapshot does not include Sparkle metadata",
          });
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
            artifactMatchesStrategy(strategy, artifact.artifactType, artifact.url),
        );

        if (!compatibleArtifact) {
          throw new HTTPException(400, {
            message: "No compatible artifact is available for this strategy",
          });
        }

        artifactPlan = {
          id: compatibleArtifact.id,
          downloadUrl: compatibleArtifact.url,
          architecture: compatibleArtifact.architecture,
          minOsVersion: compatibleArtifact.minOsVersion,
          artifactType: compatibleArtifact.artifactType,
          sizeBytes: compatibleArtifact.sizeBytes,
          sha256: compatibleArtifact.sha256,
        };
      }

      const executionId = generateId(idPrefixes.updateExecution);
      await db.insert(updateExecutions).values({
        id: executionId,
        clientId: client.id,
        appId: data.matchedAppId,
        releaseId: data.releaseId,
        artifactId: artifactPlan?.id ?? null,
        actionType: actionTypeForStrategy(strategy),
        actionStatus: "initiated",
        clientVersionBefore: data.installedVersion ?? inventoryApp.installedVersionRaw ?? null,
        clientVersionAfter: null,
        installStrategy: latestRelease?.installStrategy ?? strategy,
        errorMessage: null,
        detailsJson: JSON.stringify({
          snapshotId: data.snapshotId,
          strategy,
          localAppPath: data.localAppPath,
        }),
        durationMs: null,
        initiatedAt: now,
        completedAt: null,
      });

      return c.json({
        executionId,
        strategy,
        appId: data.matchedAppId,
        releaseId: data.releaseId,
        artifact: artifactPlan,
      });
    },
  )
  // POST /v1/install/executions/:executionId/status
  .post(
    "/install/executions/:executionId/status",
    zValidator("json", installExecutionStatusUpdateSchema, (result) => {
      if (!result.success) {
        throw new HTTPException(400, {
          res: Response.json(
            { error: "Invalid request", details: result.error.issues },
            { status: 400 },
          ),
        });
      }
    }),
    async (c) => {
      const db = createDb(c.env.DB);
      const executionId = c.req.param("executionId");
      const data = c.req.valid("json");

      const client = await db
        .select()
        .from(clients)
        .where(eq(clients.anonymousInstallId, data.installId))
        .get();
      if (!client) {
        throw new HTTPException(400, { message: "Unknown client" });
      }

      const execution = await db
        .select()
        .from(updateExecutions)
        .where(and(eq(updateExecutions.id, executionId), eq(updateExecutions.clientId, client.id)))
        .get();
      if (!execution) {
        throw new HTTPException(404, { message: "Execution not found for client" });
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
    },
  );
