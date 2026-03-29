import { zValidator } from "@hono/zod-validator";
import { createDb } from "@versioneer/db";
import {
  apps,
  artifacts,
  auditLog,
  catalogSuggestions,
  generateId,
  idPrefixes,
  installExecutions,
  releases,
  suggestionEvidence,
  trustAssertions,
} from "@versioneer/schema";
import {
  installExecutionStatusRequestSchema,
  installPrepareRequestSchema,
} from "@versioneer/validation";
import { and, eq, sql } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { Env } from "../../env";

function validationErrorResponse(result: { error: { issues: unknown[] } }) {
  return Response.json({ error: "Invalid request", details: result.error.issues }, { status: 400 });
}

async function validateInstallTarget(
  db: ReturnType<typeof createDb>,
  params: {
    appId: string;
    releaseId: string;
    artifactId?: string | null;
  },
) {
  const app = await db
    .select({
      id: apps.id,
      canonicalName: apps.canonicalName,
      status: apps.status,
    })
    .from(apps)
    .where(eq(apps.id, params.appId))
    .get();
  if (!app || app.status !== "public") {
    throw new HTTPException(404, { message: "App not found" });
  }

  const release = await db
    .select({
      id: releases.id,
      appId: releases.appId,
      versionRaw: releases.versionRaw,
      status: releases.status,
      publishedBySourceId: releases.publishedBySourceId,
    })
    .from(releases)
    .where(eq(releases.id, params.releaseId))
    .get();
  if (!release || release.appId !== params.appId || release.status === "draft") {
    throw new HTTPException(404, { message: "Release not found" });
  }

  let artifact: {
    id: string;
    releaseId: string;
  } | null = null;
  if (params.artifactId) {
    artifact =
      (await db
        .select({
          id: artifacts.id,
          releaseId: artifacts.releaseId,
        })
        .from(artifacts)
        .where(eq(artifacts.id, params.artifactId))
        .get()) ?? null;
    if (!artifact || artifact.releaseId !== params.releaseId) {
      throw new HTTPException(404, { message: "Artifact not found" });
    }
  }

  return { app, release, artifact };
}

async function upsertSuggestion(params: {
  db: ReturnType<typeof createDb>;
  queueType: "metadata_change" | "release_discrepancy";
  dedupeKey: string;
  title: string;
  proposedChangeJson: string;
  canonicalSnapshotJson?: string | null;
  appId: string;
  sourceId?: string | null;
  evidenceFingerprint: string;
  evidencePayloadJson: string;
  now: string;
}) {
  let suggestion = await params.db
    .select()
    .from(catalogSuggestions)
    .where(eq(catalogSuggestions.dedupeKey, params.dedupeKey))
    .get();

  if (!suggestion) {
    const suggestionId = generateId(idPrefixes.catalogSuggestion);
    await params.db.insert(catalogSuggestions).values({
      id: suggestionId,
      queueType: params.queueType,
      status: "pending",
      appId: params.appId,
      sourceId: params.sourceId ?? null,
      bundleKey: null,
      dedupeKey: params.dedupeKey,
      title: params.title,
      canonicalSnapshotJson: params.canonicalSnapshotJson ?? null,
      proposedChangeJson: params.proposedChangeJson,
      evidenceSummaryJson: params.evidencePayloadJson,
      evidenceCount: 1,
      firstSeenAt: params.now,
      lastSeenAt: params.now,
      createdAt: params.now,
      updatedAt: params.now,
    });
    suggestion = await params.db
      .select()
      .from(catalogSuggestions)
      .where(eq(catalogSuggestions.id, suggestionId))
      .get();
  } else {
    await params.db
      .update(catalogSuggestions)
      .set({
        canonicalSnapshotJson: params.canonicalSnapshotJson ?? suggestion.canonicalSnapshotJson,
        evidenceSummaryJson: params.evidencePayloadJson,
        lastSeenAt: params.now,
        updatedAt: params.now,
        evidenceCount: sql`${catalogSuggestions.evidenceCount} + 1`,
      })
      .where(eq(catalogSuggestions.id, suggestion.id));
  }

  if (!suggestion) return;

  const existingEvidence = await params.db
    .select({ id: suggestionEvidence.id })
    .from(suggestionEvidence)
    .where(
      and(
        eq(suggestionEvidence.suggestionId, suggestion.id),
        eq(suggestionEvidence.fingerprint, params.evidenceFingerprint),
      ),
    )
    .get();
  if (existingEvidence) return;

  await params.db.insert(suggestionEvidence).values({
    id: generateId(idPrefixes.suggestionEvidence),
    suggestionId: suggestion.id,
    appId: params.appId,
    sourceId: params.sourceId ?? null,
    evidenceType: "install_verify",
    fingerprint: params.evidenceFingerprint,
    payloadJson: params.evidencePayloadJson,
    observedAt: params.now,
    createdAt: params.now,
  });
}

async function createTrustSuggestion(params: {
  db: ReturnType<typeof createDb>;
  appId: string;
  appName: string;
  sourceId?: string | null;
  assertionType:
    | "sparkle_public_key"
    | "bundle_id"
    | "team_id"
    | "notarization_expectation"
    | "signature_requirement";
  value: string;
  canonicalSnapshotJson: string;
  evidenceFingerprint: string;
  evidencePayloadJson: string;
  now: string;
}) {
  const existingTrust = await params.db
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
  if (existingTrust) return;

  await upsertSuggestion({
    db: params.db,
    queueType: "metadata_change",
    dedupeKey: `trust:${params.appId}:${params.sourceId ?? "none"}:${params.assertionType}:${params.value}`,
    title: `Review ${params.assertionType.replaceAll("_", " ")} trust assertion for ${params.appName}`,
    proposedChangeJson: JSON.stringify({
      changeType: "trust_assertion",
      appId: params.appId,
      sourceId: params.sourceId ?? null,
      assertionType: params.assertionType,
      value: params.value,
    }),
    canonicalSnapshotJson: params.canonicalSnapshotJson,
    appId: params.appId,
    sourceId: params.sourceId ?? null,
    evidenceFingerprint: params.evidenceFingerprint,
    evidencePayloadJson: params.evidencePayloadJson,
    now: params.now,
  });
}

async function createReleaseDiscrepancySuggestion(params: {
  db: ReturnType<typeof createDb>;
  appId: string;
  appName: string;
  releaseId: string;
  sourceId?: string | null;
  issue: string;
  evidenceFingerprint: string;
  evidencePayloadJson: string;
  canonicalSnapshotJson: string;
  now: string;
}) {
  await upsertSuggestion({
    db: params.db,
    queueType: "release_discrepancy",
    dedupeKey: `release_discrepancy:${params.releaseId}:${params.issue}`,
    title: `Investigate ${params.issue.replaceAll("_", " ")} for ${params.appName}`,
    proposedChangeJson: JSON.stringify({
      appId: params.appId,
      releaseId: params.releaseId,
      sourceId: params.sourceId ?? null,
      issue: params.issue,
    }),
    canonicalSnapshotJson: params.canonicalSnapshotJson,
    appId: params.appId,
    sourceId: params.sourceId ?? null,
    evidenceFingerprint: params.evidenceFingerprint,
    evidencePayloadJson: params.evidencePayloadJson,
    now: params.now,
  });
}

export const installRoutes = new Hono<{ Bindings: Env }>()
  .post(
    "/install/prepare",
    zValidator("json", installPrepareRequestSchema, (result) => {
      if (!result.success) {
        throw new HTTPException(400, { res: validationErrorResponse(result) });
      }
    }),
    async (c) => {
      const data = c.req.valid("json");
      const db = createDb(c.env.DB);
      const now = new Date().toISOString();
      const target = await validateInstallTarget(db, data);
      const executionId = generateId(idPrefixes.installExecution);

      await db.insert(installExecutions).values({
        id: executionId,
        appId: target.app.id,
        releaseId: target.release.id,
        artifactId: data.artifactId ?? null,
        clientPlatform: data.client.platform,
        clientAppVersion: data.client.appVersion ?? null,
        clientOsVersion: data.client.osVersion ?? null,
        clientSystemArchitecture: data.client.systemArchitecture ?? null,
        channel: data.channel ?? null,
        installStrategy: data.installStrategy,
        executionRoute: data.executionRoute ?? null,
        status: "prepared",
        expectedBundleId: data.bundleId ?? null,
        expectedTeamId: data.teamId ?? null,
        previousVersion: data.previousVersion ?? null,
        installedVersion: null,
        errorMessage: null,
        verificationJson: null,
        preparedAt: now,
        completedAt: null,
        createdAt: now,
        updatedAt: now,
      });

      await db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        eventType: "install_execution_prepared",
        actorType: "client",
        actorId: null,
        targetType: "install_execution",
        targetId: executionId,
        payloadJson: JSON.stringify({
          appId: data.appId,
          releaseId: data.releaseId,
          artifactId: data.artifactId ?? null,
          installStrategy: data.installStrategy,
          executionRoute: data.executionRoute ?? null,
        }),
        createdAt: now,
      });

      return c.json({ executionId, status: "prepared" as const });
    },
  )
  .post(
    "/install/executions/:executionId/status",
    zValidator("json", installExecutionStatusRequestSchema, (result) => {
      if (!result.success) {
        throw new HTTPException(400, { res: validationErrorResponse(result) });
      }
    }),
    async (c) => {
      const executionId = c.req.param("executionId");
      const data = c.req.valid("json");
      const db = createDb(c.env.DB);
      const now = new Date().toISOString();
      const target = await validateInstallTarget(db, data);
      const existing = await db
        .select()
        .from(installExecutions)
        .where(eq(installExecutions.id, executionId))
        .get();

      if (existing && (existing.appId !== data.appId || existing.releaseId !== data.releaseId)) {
        throw new HTTPException(409, { message: "Execution does not match install target" });
      }

      const verificationJson = data.verification ? JSON.stringify(data.verification) : null;
      const completedAt = data.status === "started" ? (existing?.completedAt ?? null) : now;

      if (existing) {
        await db
          .update(installExecutions)
          .set({
            artifactId: data.artifactId ?? existing.artifactId,
            clientPlatform: data.client.platform,
            clientAppVersion: data.client.appVersion ?? null,
            clientOsVersion: data.client.osVersion ?? null,
            clientSystemArchitecture: data.client.systemArchitecture ?? null,
            channel: data.channel ?? existing.channel,
            installStrategy: data.installStrategy,
            executionRoute:
              data.executionRoute ?? data.verification?.executionRoute ?? existing.executionRoute,
            status: data.status,
            expectedBundleId: data.bundleId ?? existing.expectedBundleId,
            expectedTeamId: data.teamId ?? existing.expectedTeamId,
            previousVersion: data.previousVersion ?? existing.previousVersion,
            installedVersion: data.installedVersion ?? existing.installedVersion,
            errorMessage: data.errorMessage ?? null,
            verificationJson,
            completedAt,
            updatedAt: now,
          })
          .where(eq(installExecutions.id, executionId));
      } else {
        await db.insert(installExecutions).values({
          id: executionId,
          appId: target.app.id,
          releaseId: target.release.id,
          artifactId: data.artifactId ?? null,
          clientPlatform: data.client.platform,
          clientAppVersion: data.client.appVersion ?? null,
          clientOsVersion: data.client.osVersion ?? null,
          clientSystemArchitecture: data.client.systemArchitecture ?? null,
          channel: data.channel ?? null,
          installStrategy: data.installStrategy,
          executionRoute: data.executionRoute ?? data.verification?.executionRoute ?? null,
          status: data.status,
          expectedBundleId: data.bundleId ?? null,
          expectedTeamId: data.teamId ?? null,
          previousVersion: data.previousVersion ?? null,
          installedVersion: data.installedVersion ?? null,
          errorMessage: data.errorMessage ?? null,
          verificationJson,
          preparedAt: now,
          completedAt,
          createdAt: now,
          updatedAt: now,
        });
      }

      const canonicalSnapshotJson = JSON.stringify({
        appId: target.app.id,
        appName: target.app.canonicalName,
        releaseId: target.release.id,
        releaseVersion: target.release.versionRaw,
        sourceId: target.release.publishedBySourceId ?? null,
      });
      const evidencePayloadJson = JSON.stringify({
        status: data.status,
        errorMessage: data.errorMessage ?? null,
        installStrategy: data.installStrategy,
        executionRoute: data.executionRoute ?? data.verification?.executionRoute ?? null,
        previousVersion: data.previousVersion ?? null,
        installedVersion: data.installedVersion ?? null,
        bundleId: data.bundleId ?? null,
        teamId: data.teamId ?? null,
        verification: data.verification ?? null,
      });

      if (data.status === "succeeded" && data.verification) {
        if (data.verification.bundleIdMatch && data.verification.observedBundleId) {
          await createTrustSuggestion({
            db,
            appId: target.app.id,
            appName: target.app.canonicalName,
            sourceId: target.release.publishedBySourceId ?? null,
            assertionType: "bundle_id",
            value: data.verification.observedBundleId,
            canonicalSnapshotJson,
            evidenceFingerprint: `install-trust:${executionId}:bundle_id:${data.verification.observedBundleId}`,
            evidencePayloadJson,
            now,
          });
        }
        if (data.verification.teamIdMatch && data.verification.observedTeamId) {
          await createTrustSuggestion({
            db,
            appId: target.app.id,
            appName: target.app.canonicalName,
            sourceId: target.release.publishedBySourceId ?? null,
            assertionType: "team_id",
            value: data.verification.observedTeamId,
            canonicalSnapshotJson,
            evidenceFingerprint: `install-trust:${executionId}:team_id:${data.verification.observedTeamId}`,
            evidencePayloadJson,
            now,
          });
        }
        if (data.verification.signatureVerified) {
          await createTrustSuggestion({
            db,
            appId: target.app.id,
            appName: target.app.canonicalName,
            sourceId: target.release.publishedBySourceId ?? null,
            assertionType: "signature_requirement",
            value: "required",
            canonicalSnapshotJson,
            evidenceFingerprint: `install-trust:${executionId}:signature_requirement:required`,
            evidencePayloadJson,
            now,
          });
        }
        if (data.verification.notarizationVerified) {
          await createTrustSuggestion({
            db,
            appId: target.app.id,
            appName: target.app.canonicalName,
            sourceId: target.release.publishedBySourceId ?? null,
            assertionType: "notarization_expectation",
            value: "required",
            canonicalSnapshotJson,
            evidenceFingerprint: `install-trust:${executionId}:notarization_expectation:required`,
            evidencePayloadJson,
            now,
          });
        }
      }

      if (data.status === "failed") {
        const issues = new Set<string>();
        if (data.verification?.bundleIdMatch === false) issues.add("bundle_id_mismatch");
        if (data.verification?.teamIdMatch === false) issues.add("team_id_mismatch");
        if (data.verification?.versionMatch === false) issues.add("version_mismatch");
        if (data.errorMessage?.toLowerCase().includes("hash"))
          issues.add("hash_verification_failed");
        if (data.errorMessage?.toLowerCase().includes("signature"))
          issues.add("signature_verification_failed");
        if (data.errorMessage?.toLowerCase().includes("notar"))
          issues.add("notarization_verification_failed");
        if (issues.size === 0) issues.add("install_failed");

        for (const issue of issues) {
          await createReleaseDiscrepancySuggestion({
            db,
            appId: target.app.id,
            appName: target.app.canonicalName,
            releaseId: target.release.id,
            sourceId: target.release.publishedBySourceId ?? null,
            issue,
            evidenceFingerprint: `install-discrepancy:${executionId}:${issue}`,
            evidencePayloadJson,
            canonicalSnapshotJson,
            now,
          });
        }
      }

      await db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        eventType: "install_execution_reported",
        actorType: "client",
        actorId: null,
        targetType: "install_execution",
        targetId: executionId,
        payloadJson: JSON.stringify({
          appId: data.appId,
          releaseId: data.releaseId,
          status: data.status,
          errorMessage: data.errorMessage ?? null,
        }),
        createdAt: now,
      });

      return c.json({ executionId, status: "recorded" as const });
    },
  );
