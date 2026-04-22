import { eq, and, inArray } from "drizzle-orm";

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
import {
  rankArtifactForTarget,
  targetArchitectureValues,
  type TargetArchitecture,
} from "@versioneer/schemas/architecture";
import type { InstallStrategy } from "@versioneer/schemas/releases";

import { deleteCachedLatest, setCachedLatest, recentReleasesKey } from "../cache";
import type { CacheKV } from "../cache";
import type { RecomputeLatestEnv, RecomputeLatestJob } from "./types";

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

type ReleaseRow = typeof releases.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;

function sortReleasesDescending(a: ReleaseRow, b: ReleaseRow): number {
  if (b.versionNormalized > a.versionNormalized) return 1;
  if (b.versionNormalized < a.versionNormalized) return -1;
  if ((b.releasedAt ?? "") > (a.releasedAt ?? "")) return 1;
  if ((b.releasedAt ?? "") < (a.releasedAt ?? "")) return -1;
  if (b.createdAt > a.createdAt) return 1;
  if (b.createdAt < a.createdAt) return -1;
  return 0;
}

function selectBestArtifactForTarget(
  releaseArtifacts: ArtifactRow[],
  targetArchitecture: TargetArchitecture,
): ArtifactRow | null {
  let best: { artifact: ArtifactRow; rank: number } | null = null;
  for (const artifact of releaseArtifacts) {
    const rank = rankArtifactForTarget(artifact.architecture, targetArchitecture);
    if (rank < 0) continue;
    if (!best || rank > best.rank) {
      best = { artifact, rank };
      continue;
    }
    if (rank === best.rank && artifact.createdAt > best.artifact.createdAt) {
      best = { artifact, rank };
    }
  }
  return best?.artifact ?? null;
}

function candidateForTarget(
  release: ReleaseRow,
  artifactsByRelease: ReadonlyMap<string, ArtifactRow[]>,
  targetArchitecture: TargetArchitecture,
): { release: ReleaseRow; artifact: ArtifactRow | null } | null {
  const releaseArtifacts = artifactsByRelease.get(release.id) ?? [];
  if (releaseArtifacts.length === 0) return { release, artifact: null };
  const artifact = selectBestArtifactForTarget(releaseArtifacts, targetArchitecture);
  return artifact ? { release, artifact } : null;
}

export async function handleRecomputeLatest(
  job: RecomputeLatestJob,
  env: RecomputeLatestEnv,
): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date().toISOString();

  let channels: string[];
  if (job.channel) {
    channels = [job.channel];
  } else {
    const activeReleaseChannels = await db
      .selectDistinct({ channel: releases.channel })
      .from(releases)
      .where(and(eq(releases.appId, job.appId), eq(releases.status, "active")))
      .all();
    const existingLatestChannels = await db
      .selectDistinct({ channel: appLatestReleases.channel })
      .from(appLatestReleases)
      .where(eq(appLatestReleases.appId, job.appId))
      .all();
    channels = [
      ...new Set([
        ...activeReleaseChannels.map((row) => row.channel),
        ...existingLatestChannels.map((row) => row.channel),
      ]),
    ];
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

    const candidateIds = new Set(candidateReleases.map((release) => release.id));
    const releaseArtifacts =
      candidateReleases.length > 0
        ? await db
            .select()
            .from(artifacts)
            .where(
              inArray(
                artifacts.releaseId,
                candidateReleases.map((release) => release.id),
              ),
            )
            .all()
        : [];
    const artifactsByRelease = new Map<string, ArtifactRow[]>();
    for (const artifact of releaseArtifacts) {
      const rows = artifactsByRelease.get(artifact.releaseId) ?? [];
      rows.push(artifact);
      artifactsByRelease.set(artifact.releaseId, rows);
    }
    candidateReleases.sort(sortReleasesDescending);

    for (const targetArchitecture of targetArchitectureValues) {
      const existingLatest = await db
        .select()
        .from(appLatestReleases)
        .where(
          and(
            eq(appLatestReleases.appId, job.appId),
            eq(appLatestReleases.channel, channel),
            eq(appLatestReleases.targetArchitecture, targetArchitecture),
          ),
        )
        .get();

      let winning = null as { release: ReleaseRow; artifact: ArtifactRow | null } | null;
      if (existingLatest?.pinnedReleaseId) {
        const pinnedRelease = candidateReleases.find(
          (r) => r.id === existingLatest.pinnedReleaseId,
        );
        if (pinnedRelease) {
          winning = candidateForTarget(pinnedRelease, artifactsByRelease, targetArchitecture);
        }
        if (!winning) {
          await db
            .update(appLatestReleases)
            .set({ pinnedReleaseId: null, updatedAt: now })
            .where(eq(appLatestReleases.id, existingLatest.id));
        }
      }

      if (!winning) {
        for (const candidateRelease of candidateReleases) {
          winning = candidateForTarget(candidateRelease, artifactsByRelease, targetArchitecture);
          if (winning) break;
        }
      }

      if (!winning || !candidateIds.has(winning.release.id)) {
        if (existingLatest) {
          await db.delete(appLatestReleases).where(eq(appLatestReleases.id, existingLatest.id));
          await deleteCachedLatest(env.CACHE_KV, job.appId, channel, targetArchitecture);
        }
        continue;
      }

      const installStrategy = inferInstallStrategy(
        authoritySource?.sourceType ?? null,
        winning.artifact?.artifactType ?? null,
      );

      if (existingLatest) {
        await db
          .update(appLatestReleases)
          .set({
            releaseId: winning.release.id,
            artifactId: winning.artifact?.id ?? null,
            authoritySourceId: authoritySource?.id ?? null,
            versionNormalized: winning.release.versionNormalized,
            versionRaw: winning.release.versionRaw,
            releasedAt: winning.release.releasedAt,
            installStrategy,
            updatedAt: now,
          })
          .where(eq(appLatestReleases.id, existingLatest.id));
      } else {
        await db.insert(appLatestReleases).values({
          id: generateId(idPrefixes.appLatestRelease),
          appId: job.appId,
          channel,
          targetArchitecture,
          releaseId: winning.release.id,
          authoritySourceId: authoritySource?.id ?? null,
          artifactId: winning.artifact?.id ?? null,
          versionNormalized: winning.release.versionNormalized,
          versionRaw: winning.release.versionRaw,
          releasedAt: winning.release.releasedAt,
          installStrategy,
          updatedAt: now,
        });
      }

      const cacheKV: CacheKV = env.CACHE_KV;
      await setCachedLatest(cacheKV, {
        appId: job.appId,
        releaseId: winning.release.id,
        versionNormalized: winning.release.versionNormalized,
        versionRaw: winning.release.versionRaw,
        channel,
        targetArchitecture,
        releasedAt: winning.release.releasedAt,
        updatedAt: now,
      });
    }
  }

  // Bust the recent-releases cache so the marketing page updates promptly
  const cacheKV: CacheKV = env.CACHE_KV;
  await cacheKV.delete(recentReleasesKey());
}
