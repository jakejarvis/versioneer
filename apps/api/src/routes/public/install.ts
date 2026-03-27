import { zValidator } from "@hono/zod-validator";
import { createDb } from "@versioneer/db";
import {
  apps,
  appAliases,
  artifacts,
  releases,
  clients,
  clientInventorySnapshots,
  clientInventoryApps,
  installRules,
  updateExecutions,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import {
  installPrepareRequestSchema,
  installExecutionStatusUpdateSchema,
} from "@versioneer/validation";
import type { AppDecision } from "@versioneer/validation";
import { eq, and } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../../env";
import { isArchCompatible, isOsVersionCompatible, deriveInstallabilityClass } from "./helpers";

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
    zValidator("json", installPrepareRequestSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: "Invalid request", details: result.error.issues }, 400);
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
          return c.json(
            { error: "Latest inventory snapshot does not include Sparkle metadata" },
            400,
          );
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
          return c.json(
            { error: "No compatible artifact is available for this install rule" },
            400,
          );
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
    },
  )
  // POST /v1/install/executions/:executionId/status
  .post(
    "/install/executions/:executionId/status",
    zValidator("json", installExecutionStatusUpdateSchema, (result, c) => {
      if (!result.success) {
        return c.json({ error: "Invalid request", details: result.error.issues }, 400);
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
    },
  );
