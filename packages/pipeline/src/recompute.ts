import { setCachedLatest } from "@versioneer/cache";
import type { CacheKV } from "@versioneer/cache";
import { createDb } from "@versioneer/db";
import {
  apps,
  releases,
  artifacts,
  appLatestReleases,
  adminOverrides,
  installRules,
  reviewQueue,
  onboardingChecklists,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { compareVersionStrings } from "@versioneer/versioning";
import { eq, and, desc } from "drizzle-orm";

import { generatePublicationExplanation, generateArtifactSelectionExplanation } from "./explain";
import { classifyInstallability } from "./installability";
import type { Env, RecomputeLatestJob } from "./types";

const CHANNELS = ["stable", "beta", "nightly"] as const;

export async function handleRecomputeLatest(job: RecomputeLatestJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date().toISOString();

  const channels = job.channel ? [job.channel] : CHANNELS;

  for (const channel of channels) {
    // Get all active releases for this app and channel
    const candidateReleases = await db
      .select()
      .from(releases)
      .where(
        and(
          eq(releases.appId, job.appId),
          eq(releases.channel, channel),
          eq(releases.status, "active"),
        ),
      )
      .all();

    if (candidateReleases.length === 0) {
      // Remove existing latest if no candidates
      const existing = await db
        .select()
        .from(appLatestReleases)
        .where(and(eq(appLatestReleases.appId, job.appId), eq(appLatestReleases.channel, channel)))
        .get();

      if (existing) {
        await db.delete(appLatestReleases).where(eq(appLatestReleases.id, existing.id));
      }
      continue;
    }

    // Check for manual override
    const override = await db
      .select()
      .from(adminOverrides)
      .where(
        and(
          eq(adminOverrides.targetType, "app_latest"),
          eq(adminOverrides.targetId, `${job.appId}:${channel}`),
          eq(adminOverrides.isActive, true),
        ),
      )
      .get();

    let winningRelease;
    let decisionSource: "pipeline" | "override" = "pipeline";

    if (override) {
      const overridePayload = JSON.parse(override.payloadJson) as { releaseId: string };
      winningRelease = candidateReleases.find((r) => r.id === overridePayload.releaseId);
      if (winningRelease) {
        decisionSource = "override";
      }
    }

    if (!winningRelease) {
      // Sort by normalized version descending, pick highest
      candidateReleases.sort((a, b) =>
        compareVersionStrings(b.versionNormalized, a.versionNormalized),
      );
      winningRelease = candidateReleases[0]!;
    }

    // Find primary artifact
    const primaryArtifact = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.releaseId, winningRelease.id), eq(artifacts.isPrimary, true)))
      .get();

    // Generate decision explanation
    const allArtifacts = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.releaseId, winningRelease.id))
      .all();

    const publicationExplanation = generatePublicationExplanation(
      winningRelease,
      candidateReleases,
      decisionSource === "override" ? override : null,
      primaryArtifact,
    );
    const artifactExplanation = generateArtifactSelectionExplanation(primaryArtifact, allArtifacts);
    const decisionExplanationJson = JSON.stringify({
      publication: publicationExplanation,
      artifact: artifactExplanation,
    });

    // Publication gating: check verification tier and quality state
    const app = await db.select().from(apps).where(eq(apps.id, job.appId)).get();
    const appRuleRecords = await db
      .select()
      .from(installRules)
      .where(eq(installRules.appId, job.appId))
      .orderBy(desc(installRules.updatedAt))
      .all();
    const selectedInstallRule =
      appRuleRecords.find((rule) => rule.enabled) ?? appRuleRecords[0] ?? null;
    const installabilityClass = classifyInstallability({
      verificationTier: app?.verificationTier ?? null,
      installRule: selectedInstallRule
        ? { strategy: selectedInstallRule.strategy, enabled: selectedInstallRule.enabled }
        : null,
      hasArtifact: primaryArtifact != null,
    });

    if (app) {
      const shouldGate =
        (app.verificationTier === "unverified" && app.qualityState !== "green") ||
        (app.verificationTier === "provisional" &&
          (app.qualityState === "red" || app.qualityState === "unknown"));

      if (shouldGate) {
        // Route to review queue instead of publishing
        await db.insert(reviewQueue).values({
          id: generateId(idPrefixes.reviewQueue),
          reviewType: "publication_gated",
          relatedId: job.appId,
          payloadJson: JSON.stringify({
            channel,
            releaseId: winningRelease.id,
            version: winningRelease.versionRaw,
            verificationTier: app.verificationTier,
            qualityState: app.qualityState,
            explanation: publicationExplanation,
          }),
          priority: 1,
          status: "pending",
          createdAt: now,
        });
        continue;
      }
    }

    // Upsert app_latest_releases
    const existing = await db
      .select()
      .from(appLatestReleases)
      .where(and(eq(appLatestReleases.appId, job.appId), eq(appLatestReleases.channel, channel)))
      .get();

    if (existing) {
      await db
        .update(appLatestReleases)
        .set({
          releaseId: winningRelease.id,
          artifactId: primaryArtifact?.id ?? null,
          versionNormalized: winningRelease.versionNormalized,
          versionRaw: winningRelease.versionRaw,
          releasedAt: winningRelease.releasedAt,
          decisionSource,
          confidence: winningRelease.sourceConfidence,
          decisionExplanationJson,
          installabilityClass,
          updatedAt: now,
        })
        .where(eq(appLatestReleases.id, existing.id));
    } else {
      await db.insert(appLatestReleases).values({
        id: generateId(idPrefixes.appLatestRelease),
        appId: job.appId,
        channel,
        releaseId: winningRelease.id,
        artifactId: primaryArtifact?.id ?? null,
        versionNormalized: winningRelease.versionNormalized,
        versionRaw: winningRelease.versionRaw,
        releasedAt: winningRelease.releasedAt,
        decisionSource,
        confidence: winningRelease.sourceConfidence,
        decisionExplanationJson,
        installabilityClass,
        updatedAt: now,
      });
    }

    // Update KV cache
    const cacheKV = env.CACHE_KV as unknown as CacheKV;
    await setCachedLatest(cacheKV, {
      appId: job.appId,
      releaseId: winningRelease.id,
      versionNormalized: winningRelease.versionNormalized,
      versionRaw: winningRelease.versionRaw,
      channel,
      releasedAt: winningRelease.releasedAt,
      updatedAt: now,
    });
  }

  // Auto-update onboarding checklist: mark reviewQueueClear if no gated items
  const checklist = await db
    .select()
    .from(onboardingChecklists)
    .where(eq(onboardingChecklists.appId, job.appId))
    .get();
  if (checklist && !checklist.isComplete && !checklist.reviewQueueClear) {
    const pendingReviews = await db
      .select({ id: reviewQueue.id })
      .from(reviewQueue)
      .where(and(eq(reviewQueue.relatedId, job.appId), eq(reviewQueue.status, "pending")))
      .get();

    if (!pendingReviews) {
      const updates: Record<string, unknown> = {
        reviewQueueClear: true,
        updatedAt: new Date().toISOString(),
      };
      const merged = { ...checklist, reviewQueueClear: true };
      const allComplete =
        merged.hasCanonicalRecord &&
        merged.hasAliases &&
        merged.hasSource &&
        merged.parserOutputVerified &&
        merged.latestReleasePublished &&
        merged.reviewQueueClear &&
        merged.qualityScoreAcceptable;
      if (allComplete) {
        updates.isComplete = true;
        updates.completedAt = new Date().toISOString();
      }
      await db
        .update(onboardingChecklists)
        .set(updates)
        .where(eq(onboardingChecklists.id, checklist.id));
    }
  }
}
