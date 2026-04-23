import { and, desc, eq, inArray, ne, sql } from "drizzle-orm";

import { createDb } from "@versioneer/db";
import {
  apps,
  sourceFetches,
  sources,
  parserRuns,
  releaseObservations,
  releases,
  artifacts,
  generateId,
  idPrefixes,
} from "@versioneer/db";
import {
  mergeArtifactArchitectures,
  normalizeArtifactArchitecture,
} from "@versioneer/schemas/architecture";

import { deleteInventoryMatchSnapshot } from "../cache";
import { inferReleasedAt, toISODate } from "../dates";
import { createLogger } from "../logger";
import { getParser } from "../parsers";
import { getDescriptor } from "../sources/registry";
import { normalizeVersion, inferChannel } from "../versioning";
import { recordSourceAnomaly } from "./anomalies";
import { buildArtifactIdentity, buildReleaseObservationIdentity } from "./artifact-identity";
import { normalizeReleaseNotes } from "./release-notes";
import { getSourceFetchUrlMetadata } from "./source-url-policy";
import type { ParseStepResult, SourceParseEnv, SourceParseJob } from "./types";

const INSTALLABLE_ARTIFACT_TYPES = new Set(["zip", "dmg", "pkg"]);
const D1_PARAM_LIMIT = 100;

type ReleaseRow = typeof releases.$inferSelect;
type ArtifactRow = typeof artifacts.$inferSelect;

function artifactHostname(rawUrl: string): string | null {
  return getSourceFetchUrlMetadata(rawUrl).hostname;
}

function releaseKey(channel: string, versionNormalized: string): string {
  return `${channel}\u0000${versionNormalized}`;
}

function uniqueStrings(values: Iterable<string>): string[] {
  return [...new Set(values)];
}

function chunkStrings(values: string[], chunkSize: number): string[][] {
  const chunks: string[][] = [];
  for (let index = 0; index < values.length; index += chunkSize) {
    chunks.push(values.slice(index, index + chunkSize));
  }
  return chunks;
}

async function selectExistingReleasesForParse(params: {
  db: ReturnType<typeof createDb>;
  appId: string;
  channels: string[];
  versionNormalizedValues: string[];
}): Promise<Map<string, ReleaseRow>> {
  const releasesByKey = new Map<string, ReleaseRow>();
  if (params.channels.length === 0 || params.versionNormalizedValues.length === 0) {
    return releasesByKey;
  }

  const channelChunks = chunkStrings(params.channels, Math.max(1, Math.floor(D1_PARAM_LIMIT / 2)));
  for (const channelChunk of channelChunks) {
    const versionChunkSize = Math.max(1, D1_PARAM_LIMIT - channelChunk.length - 1);
    for (const versionChunk of chunkStrings(params.versionNormalizedValues, versionChunkSize)) {
      const rows = await params.db
        .select()
        .from(releases)
        .where(
          and(
            eq(releases.appId, params.appId),
            inArray(releases.channel, channelChunk),
            inArray(releases.versionNormalized, versionChunk),
          ),
        )
        .all();
      for (const row of rows) {
        releasesByKey.set(releaseKey(row.channel, row.versionNormalized), row);
      }
    }
  }

  return releasesByKey;
}

async function selectArtifactsByReleaseIds(params: {
  db: ReturnType<typeof createDb>;
  releaseIds: string[];
}): Promise<Map<string, ArtifactRow[]>> {
  const artifactsByRelease = new Map<string, ArtifactRow[]>();
  for (const releaseChunk of chunkStrings(params.releaseIds, D1_PARAM_LIMIT)) {
    const rows = await params.db
      .select()
      .from(artifacts)
      .where(inArray(artifacts.releaseId, releaseChunk))
      .all();
    for (const row of rows) {
      const existing = artifactsByRelease.get(row.releaseId) ?? [];
      existing.push(row);
      artifactsByRelease.set(row.releaseId, existing);
    }
  }
  return artifactsByRelease;
}

function upsertArtifactRow(rows: ArtifactRow[], artifact: ArtifactRow): void {
  const existingIndex = rows.findIndex((row) => row.id === artifact.id);
  if (existingIndex >= 0) {
    rows[existingIndex] = artifact;
    return;
  }
  rows.push(artifact);
}

function selectPrimaryArtifact(rows: ArtifactRow[]): ArtifactRow | null {
  let best: ArtifactRow | null = null;
  for (const row of rows) {
    if (!best) {
      best = row;
      continue;
    }
    if (row.createdAt > best.createdAt || (row.createdAt === best.createdAt && row.id > best.id)) {
      best = row;
    }
  }
  return best;
}

async function recordParserErrorSpike(params: {
  db: ReturnType<typeof createDb>;
  sourceId: string;
  parserKey: string;
  now: string;
}) {
  const recentRuns = await params.db
    .select({ runStatus: parserRuns.runStatus })
    .from(parserRuns)
    .innerJoin(sourceFetches, eq(parserRuns.sourceFetchId, sourceFetches.id))
    .where(eq(sourceFetches.sourceId, params.sourceId))
    .orderBy(desc(parserRuns.startedAt))
    .limit(3)
    .all();

  if (recentRuns.length === 3 && recentRuns.every((run) => run.runStatus === "error")) {
    await recordSourceAnomaly({
      db: params.db,
      sourceId: params.sourceId,
      kind: "parser_error_spike",
      fingerprint: params.parserKey,
      message: `Parser ${params.parserKey} failed 3 consecutive times`,
      now: params.now,
    });
  }
}

export async function handleSourceParse(
  job: SourceParseJob,
  env: SourceParseEnv,
): Promise<ParseStepResult> {
  const db = createDb(env.DB);
  const log = createLogger({ fn: "handleSourceParse", sourceFetchId: job.sourceFetchId });
  const now = new Date().toISOString();

  // Load fetch metadata
  const fetchRecord = await db
    .select()
    .from(sourceFetches)
    .where(eq(sourceFetches.id, job.sourceFetchId))
    .get();

  if (!fetchRecord) {
    throw new Error(`Source fetch not found: ${job.sourceFetchId}`);
  }

  if (fetchRecord.fetchStatus !== "success" || !fetchRecord.r2Key) {
    // Load source just to get appId for return
    const source = await db
      .select()
      .from(sources)
      .where(eq(sources.id, fetchRecord.sourceId))
      .get();
    return { appId: source?.appId ?? "", releaseCount: 0 };
  }

  // Load source for parser key and app ID
  const source = await db.select().from(sources).where(eq(sources.id, fetchRecord.sourceId)).get();

  if (!source) {
    throw new Error(`Source not found: ${fetchRecord.sourceId}`);
  }

  // Detect bootstrap: if this is the source's first fetch, don't infer
  // release dates — those releases pre-date our tracking.
  const priorFetch = await db
    .select({ id: sourceFetches.id })
    .from(sourceFetches)
    .where(and(eq(sourceFetches.sourceId, source.id), ne(sourceFetches.id, fetchRecord.id)))
    .limit(1)
    .get();
  const isInitialFetch = !priorFetch;

  // Get parser
  const parser = getParser(source.parserKey);
  if (!parser) {
    throw new Error(`Parser not found: ${source.parserKey}`);
  }

  // Read raw body from R2
  const r2Object = await env.RAW_BUCKET.get(fetchRecord.r2Key);
  if (!r2Object) {
    throw new Error(`R2 object not found: ${fetchRecord.r2Key}`);
  }
  const body = await r2Object.text();

  const parserRunId = generateId(idPrefixes.parserRun);

  let config: Record<string, unknown> = {};
  if (source.configJson) {
    try {
      config = JSON.parse(source.configJson) as Record<string, unknown>;
    } catch {
      await db.insert(parserRuns).values({
        id: parserRunId,
        sourceFetchId: fetchRecord.id,
        parserKey: source.parserKey,
        parserVersion: parser.version,
        runStatus: "error",
        observationCount: 0,
        errorMessage: `Invalid configJson: ${source.configJson.slice(0, 200)}`,
        startedAt: now,
        finishedAt: new Date().toISOString(),
      });
      await recordParserErrorSpike({ db, sourceId: source.id, parserKey: source.parserKey, now });
      return { appId: source.appId, releaseCount: 0 };
    }
  }

  try {
    const artifactBase = source.baseUrl
      ? getDescriptor(source.sourceType).resolveArtifactBase(source.baseUrl)
      : source.baseUrl;
    const output = parser.parse(body, {
      ...config,
      sourceBaseUrl: artifactBase,
    });

    const runStatus =
      output.errors.length > 0 && output.releases.length > 0
        ? "partial"
        : output.releases.length > 0
          ? "success"
          : "error";

    // Insert parser run
    await db.insert(parserRuns).values({
      id: parserRunId,
      sourceFetchId: fetchRecord.id,
      parserKey: source.parserKey,
      parserVersion: output.parserVersion,
      runStatus,
      observationCount: output.releases.length,
      confidence: output.confidence,
      errorMessage: output.errors.length > 0 ? output.errors.join("; ") : null,
      startedAt: now,
      finishedAt: new Date().toISOString(),
    });
    if (runStatus === "error") {
      await recordParserErrorSpike({ db, sourceId: source.id, parserKey: source.parserKey, now });
    }

    if (output.errors.length > 0) {
      log.warn("parse had errors", {
        parserKey: source.parserKey,
        releaseCount: output.releases.length,
        errors: output.errors,
      });
    }

    // Track which releases are observed in this parse for retraction detection
    const observedReleaseIds = new Set<string>();
    const priorArtifactRows = await db
      .select({ url: artifacts.url })
      .from(artifacts)
      .innerJoin(releases, eq(artifacts.releaseId, releases.id))
      .where(and(eq(releases.appId, source.appId), eq(releases.publishedBySourceId, source.id)))
      .all();
    const knownArtifactHosts = new Set(
      priorArtifactRows
        .map((row) => artifactHostname(row.url))
        .filter((hostname): hostname is string => Boolean(hostname)),
    );
    const parsedReleaseRecords = await Promise.all(
      output.releases.map(async (parsedRelease) => {
        const versionNormalized = normalizeVersion(parsedRelease.versionRaw);
        const channel =
          source.channel ?? parsedRelease.channel ?? inferChannel(parsedRelease.versionRaw);
        return {
          parsedRelease,
          versionNormalized,
          channel,
          releasedAt: toISODate(parsedRelease.publishedAt),
          releaseNotesMarkdown: parsedRelease.releaseNotesBody
            ? await normalizeReleaseNotes(
                parsedRelease.releaseNotesBody,
                parsedRelease.releaseNotesFormat ?? "html",
              )
            : null,
        };
      }),
    );
    const existingReleasesByKey = await selectExistingReleasesForParse({
      db,
      appId: source.appId,
      channels: uniqueStrings(parsedReleaseRecords.map((record) => record.channel)),
      versionNormalizedValues: uniqueStrings(
        parsedReleaseRecords.map((record) => record.versionNormalized),
      ),
    });
    const artifactsByRelease = await selectArtifactsByReleaseIds({
      db,
      releaseIds: uniqueStrings([...existingReleasesByKey.values()].map((release) => release.id)),
    });

    // Process each parsed release
    for (const record of parsedReleaseRecords) {
      const { parsedRelease, versionNormalized, channel, releasedAt, releaseNotesMarkdown } =
        record;
      const observationId = generateId(idPrefixes.releaseObservation);
      const key = releaseKey(channel, versionNormalized);
      let matchingRelease = existingReleasesByKey.get(key);

      if (matchingRelease) {
        const updatedNotesMarkdown = parsedRelease.releaseNotesBody
          ? (releaseNotesMarkdown ?? matchingRelease.releaseNotesMarkdown)
          : matchingRelease.releaseNotesMarkdown;
        const updatedNotesHtml = parsedRelease.releaseNotesBody
          ? releaseNotesMarkdown
            ? null
            : matchingRelease.releaseNotesHtml
          : matchingRelease.releaseNotesHtml;
        matchingRelease = {
          ...matchingRelease,
          versionRaw: parsedRelease.versionRaw,
          buildNumber: parsedRelease.buildNumber ?? matchingRelease.buildNumber,
          releasedAt: releasedAt ?? matchingRelease.releasedAt,
          isPrerelease: parsedRelease.isPrerelease,
          sourceConfidence: output.confidence,
          publishedBySourceId: source.id,
          status: "active",
          releaseNotesMarkdown: updatedNotesMarkdown,
          releaseNotesHtml: updatedNotesHtml,
          releaseNotesUrl: parsedRelease.releaseNotesUrl ?? matchingRelease.releaseNotesUrl,
          updatedAt: now,
        };
        await db
          .update(releases)
          .set({
            versionRaw: matchingRelease.versionRaw,
            buildNumber: matchingRelease.buildNumber,
            releasedAt: matchingRelease.releasedAt,
            isPrerelease: matchingRelease.isPrerelease,
            sourceConfidence: matchingRelease.sourceConfidence,
            publishedBySourceId: matchingRelease.publishedBySourceId,
            status: matchingRelease.status,
            releaseNotesMarkdown: matchingRelease.releaseNotesMarkdown,
            releaseNotesHtml: matchingRelease.releaseNotesHtml,
            releaseNotesUrl: matchingRelease.releaseNotesUrl,
            updatedAt: matchingRelease.updatedAt,
          })
          .where(eq(releases.id, matchingRelease.id));
      } else {
        const releaseId = generateId(idPrefixes.release);
        const [persistedRelease] = await db
          .insert(releases)
          .values({
            id: releaseId,
            appId: source.appId,
            versionRaw: parsedRelease.versionRaw,
            versionNormalized,
            buildNumber: parsedRelease.buildNumber ?? null,
            channel,
            releasedAt: inferReleasedAt(parsedRelease.publishedAt, isInitialFetch, now),
            isPrerelease: parsedRelease.isPrerelease,
            sourceConfidence: output.confidence,
            publishedBySourceId: source.id,
            releaseNotesMarkdown,
            releaseNotesHtml: null,
            releaseNotesUrl: parsedRelease.releaseNotesUrl ?? null,
            status: "active",
            createdAt: now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: [releases.appId, releases.channel, releases.versionNormalized],
            set: {
              versionRaw: parsedRelease.versionRaw,
              buildNumber: parsedRelease.buildNumber ?? undefined,
              status: "active",
              releasedAt: releasedAt ?? undefined,
              isPrerelease: parsedRelease.isPrerelease,
              sourceConfidence: output.confidence,
              publishedBySourceId: source.id,
              releaseNotesMarkdown: releaseNotesMarkdown ?? undefined,
              releaseNotesHtml: releaseNotesMarkdown ? null : undefined,
              releaseNotesUrl: parsedRelease.releaseNotesUrl ?? undefined,
              updatedAt: now,
            },
          })
          .returning();
        if (!persistedRelease) {
          throw new Error(
            `Failed to persist release ${source.appId}:${channel}:${versionNormalized}`,
          );
        }
        matchingRelease = persistedRelease;
        if (!artifactsByRelease.has(matchingRelease.id)) {
          const persistedArtifacts = await selectArtifactsByReleaseIds({
            db,
            releaseIds: [matchingRelease.id],
          });
          artifactsByRelease.set(
            matchingRelease.id,
            persistedArtifacts.get(matchingRelease.id) ?? [],
          );
        }
      }

      existingReleasesByKey.set(key, matchingRelease);
      const releaseId = matchingRelease.id;
      observedReleaseIds.add(releaseId);

      // Insert observation
      const observationIdentity = buildReleaseObservationIdentity({
        observedVersionNormalized: versionNormalized,
        observedBuildNumber: parsedRelease.buildNumber ?? null,
        observedChannel: channel,
        observedPublishedAt: releasedAt,
        observedReleaseNotesUrl: parsedRelease.releaseNotesUrl ?? null,
        observedDownloadUrl: parsedRelease.downloadUrl ?? null,
      });

      await db
        .insert(releaseObservations)
        .values({
          id: observationId,
          parserRunId,
          appId: source.appId,
          releaseId,
          observedVersionRaw: parsedRelease.versionRaw,
          observedVersionNormalized: versionNormalized,
          observedBuildNumber: parsedRelease.buildNumber ?? null,
          observedChannel: channel,
          observedPublishedAt: releasedAt,
          observedReleaseNotesUrl: parsedRelease.releaseNotesUrl ?? null,
          observedDownloadUrl: observationIdentity.canonicalObservedDownloadUrl,
          observationKey: observationIdentity.observationKey,
          confidence: output.confidence,
          observationJson: parsedRelease.metadata ? JSON.stringify(parsedRelease.metadata) : null,
          createdAt: now,
          lastSeenAt: now,
          seenCount: 1,
        })
        .onConflictDoUpdate({
          target: [releaseObservations.releaseId, releaseObservations.observationKey],
          set: {
            parserRunId,
            appId: source.appId,
            observedVersionRaw: parsedRelease.versionRaw,
            observedVersionNormalized: versionNormalized,
            observedBuildNumber: parsedRelease.buildNumber ?? null,
            observedChannel: channel,
            observedPublishedAt: releasedAt,
            observedReleaseNotesUrl: parsedRelease.releaseNotesUrl ?? null,
            observedDownloadUrl: observationIdentity.canonicalObservedDownloadUrl,
            confidence: output.confidence,
            observationJson: parsedRelease.metadata ? JSON.stringify(parsedRelease.metadata) : null,
            lastSeenAt: now,
            seenCount: sql`${releaseObservations.seenCount} + 1`,
          },
        });

      // Upsert artifacts using stable identity instead of raw presigned URLs.
      const releaseArtifacts = artifactsByRelease.get(releaseId) ?? [];
      const existingByUrl = new Map(
        releaseArtifacts.map((artifact) => [artifact.url, artifact] as const),
      );
      const existingByCanonicalUrl = new Map(
        releaseArtifacts.map((artifact) => [artifact.canonicalUrl, artifact] as const),
      );
      const existingByIdentityKey = new Map(
        releaseArtifacts.map((artifact) => [artifact.identityKey, artifact] as const),
      );
      for (const artifact of releaseArtifacts) {
        const derivedIdentity = buildArtifactIdentity({
          url: artifact.url,
          sha256: artifact.sha256,
        });
        existingByCanonicalUrl.set(derivedIdentity.canonicalUrl, artifact);
        existingByIdentityKey.set(derivedIdentity.identityKey, artifact);
      }

      for (const parsedArtifact of parsedRelease.artifacts) {
        const architecture = normalizeArtifactArchitecture(parsedArtifact.architecture);
        const artifactIdentity = buildArtifactIdentity({
          url: parsedArtifact.url,
          sha256: parsedArtifact.sha256,
        });
        const hostname = artifactHostname(parsedArtifact.url);
        if (hostname) {
          if (knownArtifactHosts.size > 0 && !knownArtifactHosts.has(hostname)) {
            await recordSourceAnomaly({
              db,
              sourceId: source.id,
              kind: "new_artifact_hostname",
              fingerprint: hostname,
              message: `Source produced artifact from new hostname: ${hostname}`,
              now,
            });
          }
          knownArtifactHosts.add(hostname);
        }
        if (
          INSTALLABLE_ARTIFACT_TYPES.has(parsedArtifact.type) &&
          !parsedArtifact.sha256 &&
          !parsedArtifact.signature
        ) {
          const missingHashFingerprint = artifactIdentity.canonicalUrl;
          await recordSourceAnomaly({
            db,
            sourceId: source.id,
            kind: "missing_install_hash",
            fingerprint: missingHashFingerprint,
            message: `Installable ${parsedArtifact.type} artifact is missing SHA-256: ${artifactIdentity.canonicalUrl}`,
            now,
          });
        }

        const existingArtifact =
          existingByIdentityKey.get(artifactIdentity.identityKey) ??
          existingByCanonicalUrl.get(artifactIdentity.canonicalUrl) ??
          existingByUrl.get(parsedArtifact.url);
        if (existingArtifact) {
          const mergedArchitecture = mergeArtifactArchitectures(
            existingArtifact.architecture,
            architecture,
          );
          await db
            .update(artifacts)
            .set({
              artifactType: parsedArtifact.type,
              url: parsedArtifact.url,
              canonicalUrl: artifactIdentity.canonicalUrl,
              identityKey: artifactIdentity.identityKey,
              sha256: parsedArtifact.sha256 ?? undefined,
              sizeBytes: parsedArtifact.sizeBytes ?? undefined,
              architecture: mergedArchitecture,
              minOsVersion: parsedArtifact.minOsVersion ?? undefined,
            })
            .where(eq(artifacts.id, existingArtifact.id));
          const mergedArtifact = {
            ...existingArtifact,
            artifactType: parsedArtifact.type,
            url: parsedArtifact.url,
            canonicalUrl: artifactIdentity.canonicalUrl,
            identityKey: artifactIdentity.identityKey,
            sha256: parsedArtifact.sha256 ?? existingArtifact.sha256,
            sizeBytes: parsedArtifact.sizeBytes ?? existingArtifact.sizeBytes,
            architecture: mergedArchitecture,
            minOsVersion: parsedArtifact.minOsVersion ?? existingArtifact.minOsVersion,
          };
          upsertArtifactRow(releaseArtifacts, mergedArtifact);
          existingByUrl.set(parsedArtifact.url, mergedArtifact);
          existingByCanonicalUrl.set(artifactIdentity.canonicalUrl, mergedArtifact);
          existingByIdentityKey.set(artifactIdentity.identityKey, mergedArtifact);
          continue;
        }

        const artifactId = generateId(idPrefixes.artifact);
        const [persistedArtifact] = await db
          .insert(artifacts)
          .values({
            id: artifactId,
            releaseId,
            artifactType: parsedArtifact.type,
            url: parsedArtifact.url,
            canonicalUrl: artifactIdentity.canonicalUrl,
            identityKey: artifactIdentity.identityKey,
            sha256: parsedArtifact.sha256 ?? null,
            sizeBytes: parsedArtifact.sizeBytes ?? null,
            architecture,
            minOsVersion: parsedArtifact.minOsVersion ?? null,
            isPrimary: false,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: [artifacts.releaseId, artifacts.identityKey],
            set: {
              artifactType: parsedArtifact.type,
              url: parsedArtifact.url,
              canonicalUrl: artifactIdentity.canonicalUrl,
              sha256: parsedArtifact.sha256 ?? undefined,
              sizeBytes: parsedArtifact.sizeBytes ?? undefined,
              architecture,
              minOsVersion: parsedArtifact.minOsVersion ?? undefined,
            },
          })
          .returning();
        if (!persistedArtifact) {
          throw new Error(
            `Failed to persist artifact ${releaseId}:${artifactIdentity.identityKey}`,
          );
        }
        upsertArtifactRow(releaseArtifacts, persistedArtifact);
        existingByUrl.set(parsedArtifact.url, persistedArtifact);
        existingByCanonicalUrl.set(artifactIdentity.canonicalUrl, persistedArtifact);
        existingByIdentityKey.set(artifactIdentity.identityKey, persistedArtifact);
      }

      // Ensure exactly one primary artifact per release (prefer newest)
      const primaryArtifact = selectPrimaryArtifact(releaseArtifacts);
      const activePrimaryIds = releaseArtifacts
        .filter((artifact) => artifact.isPrimary)
        .map((artifact) => artifact.id);
      if (
        primaryArtifact &&
        (activePrimaryIds.length !== 1 || activePrimaryIds[0] !== primaryArtifact.id)
      ) {
        await db
          .update(artifacts)
          .set({ isPrimary: false })
          .where(eq(artifacts.releaseId, releaseId));
        await db
          .update(artifacts)
          .set({ isPrimary: true })
          .where(eq(artifacts.id, primaryArtifact.id));
        for (const artifact of releaseArtifacts) {
          artifact.isPrimary = artifact.id === primaryArtifact.id;
        }
      }
    }

    // Withdraw releases no longer present in the feed.  Only run when:
    //  - this isn't the first fetch (no prior data to compare against)
    //  - the parse succeeded cleanly (no partial failures that could cause
    //    false withdrawals)
    if (!isInitialFetch && output.releases.length > 0 && output.errors.length === 0) {
      const priorReleases = await db
        .select({ id: releases.id })
        .from(releases)
        .where(
          and(
            eq(releases.appId, source.appId),
            eq(releases.publishedBySourceId, source.id),
            eq(releases.status, "active"),
          ),
        )
        .all();

      const withdrawnIds = priorReleases
        .filter((prior) => !observedReleaseIds.has(prior.id))
        .map((prior) => prior.id);
      for (const withdrawnChunk of chunkStrings(withdrawnIds, D1_PARAM_LIMIT)) {
        await db
          .update(releases)
          .set({ status: "withdrawn", updatedAt: now })
          .where(inArray(releases.id, withdrawnChunk));
      }
      const withdrawnCount = withdrawnIds.length;
      if (withdrawnCount > 0) {
        log.info("withdrew releases absent from feed", { count: withdrawnCount });
      }
    }

    if (
      output.releases.length > 0 &&
      source.reviewStatus === "approved" &&
      source.role === "authority"
    ) {
      const app = await db.select().from(apps).where(eq(apps.id, source.appId)).get();
      if (app && app.status === "draft") {
        await db
          .update(apps)
          .set({
            status: "public",
            publicTrackedAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          })
          .where(eq(apps.id, source.appId));
        await deleteInventoryMatchSnapshot(env.CACHE_KV);
        log.info("app promoted to public", { appId: source.appId });
      }
    }

    log.info("parse completed", {
      parserKey: source.parserKey,
      releaseCount: output.releases.length,
    });
    return { appId: source.appId, releaseCount: output.releases.length };
  } catch (error) {
    log.error("parse failed", { parserKey: source.parserKey, error });
    const errorMsg = error instanceof Error ? error.message : String(error);

    await db.insert(parserRuns).values({
      id: parserRunId,
      sourceFetchId: fetchRecord.id,
      parserKey: source.parserKey,
      parserVersion: parser.version,
      runStatus: "error",
      observationCount: 0,
      errorMessage: errorMsg,
      startedAt: now,
      finishedAt: new Date().toISOString(),
    });
    await recordParserErrorSpike({ db, sourceId: source.id, parserKey: source.parserKey, now });

    throw error;
  }
}
