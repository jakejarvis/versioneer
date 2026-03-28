import { setCachedLatest } from "@versioneer/cache";
import type { CacheKV } from "@versioneer/cache";
import { createDb } from "@versioneer/db";
import {
  apps,
  releases,
  artifacts,
  appLatestReleases,
  sources,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { compareVersionStrings } from "@versioneer/versioning";
import { eq, and } from "drizzle-orm";

import type { Env, RecomputeLatestJob } from "./types";

const CHANNELS = ["stable", "beta", "nightly"] as const;

/**
 * Infer install strategy from source type and artifact type.
 * Admin override on the app record takes precedence.
 */
function inferInstallStrategy(
  appOverride: string | null,
  sourceType: string | null,
  artifactType: string | null,
): "sparkle" | "zip_replace" | "dmg_copy_replace" | "pkg_install" | "manual_only" {
  if (appOverride) {
    return appOverride as ReturnType<typeof inferInstallStrategy>;
  }
  if (sourceType === "sparkle") return "sparkle";
  if (artifactType === "dmg") return "dmg_copy_replace";
  if (artifactType === "zip") return "zip_replace";
  if (artifactType === "pkg") return "pkg_install";
  return "manual_only";
}

export async function handleRecomputeLatest(job: RecomputeLatestJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date().toISOString();

  const channels = job.channel ? [job.channel] : CHANNELS;

  // Load app and its primary source type for strategy inference
  const app = await db.select().from(apps).where(eq(apps.id, job.appId)).get();
  if (!app) return;

  const appSources = await db
    .select({ sourceType: sources.sourceType })
    .from(sources)
    .where(and(eq(sources.appId, job.appId), eq(sources.status, "active")))
    .all();
  const primarySourceType = appSources[0]?.sourceType ?? null;

  for (const channel of channels) {
    // Get all active, non-retracted releases for this app and channel
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

    // Check for pinned release
    const existingLatest = await db
      .select()
      .from(appLatestReleases)
      .where(and(eq(appLatestReleases.appId, job.appId), eq(appLatestReleases.channel, channel)))
      .get();

    let winningRelease;

    if (existingLatest?.pinnedReleaseId) {
      winningRelease = candidateReleases.find((r) => r.id === existingLatest.pinnedReleaseId);
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

    // Infer install strategy
    const installStrategy = inferInstallStrategy(
      app.installStrategyOverride,
      primarySourceType,
      primaryArtifact?.artifactType ?? null,
    );

    // Upsert app_latest_releases
    if (existingLatest) {
      await db
        .update(appLatestReleases)
        .set({
          releaseId: winningRelease.id,
          artifactId: primaryArtifact?.id ?? null,
          versionNormalized: winningRelease.versionNormalized,
          versionRaw: winningRelease.versionRaw,
          releasedAt: winningRelease.releasedAt,
          installStrategy,
          updatedAt: now,
        })
        .where(eq(appLatestReleases.id, existingLatest.id));
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
        installStrategy,
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
