import { setCachedLatest } from "@macupdater/cache";
import type { CacheKV } from "@macupdater/cache";
import { createDb } from "@macupdater/db";
import {
  releases,
  artifacts,
  appLatestReleases,
  adminOverrides,
  generateId,
  idPrefixes,
} from "@macupdater/schema";
import { compareVersionStrings } from "@macupdater/versioning";
import { eq, and } from "drizzle-orm";

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
}
