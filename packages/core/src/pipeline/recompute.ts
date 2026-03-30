import { createDb } from "@versioneer/db";
import {
  apps,
  releases,
  artifacts,
  appLatestReleases,
  sources,
  generateId,
  idPrefixes,
} from "@versioneer/db";
import type { InstallStrategy } from "@versioneer/schemas/releases";
import { eq, and } from "drizzle-orm";

import { setCachedLatest, recentReleasesKey } from "../cache";
import type { CacheKV } from "../cache";
import { compareVersionStrings } from "../versioning";
import type { Env, RecomputeLatestJob } from "./types";

/**
 * Infer install strategy from source type and artifact type.
 * Admin override on the app record takes precedence.
 */
function inferInstallStrategy(
  sourceType: string | null,
  artifactType: string | null,
): InstallStrategy {
  if (sourceType === "sparkle") return "sparkle";
  if (sourceType === "mac_app_store") return "mac_app_store";
  if (artifactType === "dmg") return "dmg_copy_replace";
  if (artifactType === "zip") return "zip_replace";
  if (artifactType === "pkg") return "pkg_install";
  return "manual_only";
}

export async function handleRecomputeLatest(job: RecomputeLatestJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date().toISOString();

  let channels: string[];
  if (job.channel) {
    channels = [job.channel];
  } else {
    const rows = await db
      .selectDistinct({ channel: releases.channel })
      .from(releases)
      .where(and(eq(releases.appId, job.appId), eq(releases.status, "active")))
      .all();
    channels = rows.map((r) => r.channel);
    if (channels.length === 0) channels = ["stable"];
  }

  // Load app and its approved authority sources for strategy inference
  const app = await db.select().from(apps).where(eq(apps.id, job.appId)).get();
  if (!app) return;

  const appSources = await db
    .select({
      id: sources.id,
      sourceType: sources.sourceType,
      channel: sources.channel,
    })
    .from(sources)
    .where(
      and(
        eq(sources.appId, job.appId),
        eq(sources.status, "active"),
        eq(sources.reviewStatus, "approved"),
        eq(sources.role, "authority"),
      ),
    )
    .all();

  for (const channel of channels) {
    const authoritySource =
      appSources.find((source) => source.channel === channel) ??
      appSources.find((source) => source.channel === null) ??
      null;

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

    // Check for pinned release
    const existingLatest = await db
      .select()
      .from(appLatestReleases)
      .where(and(eq(appLatestReleases.appId, job.appId), eq(appLatestReleases.channel, channel)))
      .get();

    let winningRelease;

    if (existingLatest?.pinnedReleaseId) {
      winningRelease = candidateReleases.find((r) => r.id === existingLatest.pinnedReleaseId);
      // Clear stale pin if the pinned release is no longer an active candidate
      if (!winningRelease) {
        await db
          .update(appLatestReleases)
          .set({ pinnedReleaseId: null, updatedAt: now })
          .where(eq(appLatestReleases.id, existingLatest.id));
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

    // Infer install strategy
    const installStrategy = inferInstallStrategy(
      authoritySource?.sourceType ?? null,
      primaryArtifact?.artifactType ?? null,
    );

    // Upsert app_latest_releases
    if (existingLatest) {
      await db
        .update(appLatestReleases)
        .set({
          releaseId: winningRelease.id,
          artifactId: primaryArtifact?.id ?? null,
          authoritySourceId: authoritySource?.id ?? null,
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
        authoritySourceId: authoritySource?.id ?? null,
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

  // Bust the recent-releases cache so the marketing page updates promptly
  const cacheKV = env.CACHE_KV as unknown as CacheKV;
  await cacheKV.delete(recentReleasesKey());
}
