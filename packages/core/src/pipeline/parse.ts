import { and, desc, eq, ne } from "drizzle-orm";

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
import { normalizeArtifactArchitecture } from "@versioneer/schemas/architecture";

import { inferReleasedAt, toISODate } from "../dates";
import { createLogger } from "../logger";
import { getParser } from "../parsers";
import { getDescriptor } from "../sources/registry";
import { normalizeVersion, inferChannel } from "../versioning";
import { recordSourceAnomaly } from "./anomalies";
import { normalizeReleaseNotes } from "./release-notes";
import { getSourceFetchUrlMetadata } from "./source-url-policy";
import type { ParseStepResult, SourceParseEnv, SourceParseJob } from "./types";

const INSTALLABLE_ARTIFACT_TYPES = new Set(["zip", "dmg", "pkg"]);

function artifactHostname(rawUrl: string): string | null {
  return getSourceFetchUrlMetadata(rawUrl).hostname;
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

    // Process each parsed release
    for (const parsedRelease of output.releases) {
      const observationId = generateId(idPrefixes.releaseObservation);
      const versionNormalized = normalizeVersion(parsedRelease.versionRaw);
      const channel =
        source.channel ?? parsedRelease.channel ?? inferChannel(parsedRelease.versionRaw);

      // Upsert release: check if version already exists for this app + channel
      let releaseId: string | undefined;
      const matchingRelease = await db
        .select()
        .from(releases)
        .where(
          and(
            eq(releases.appId, source.appId),
            eq(releases.versionNormalized, versionNormalized),
            eq(releases.channel, channel),
          ),
        )
        .get();

      if (matchingRelease) {
        releaseId = matchingRelease.id;
        // Update if we have newer info; re-activate if previously withdrawn
        const parsedNotesMarkdown = parsedRelease.releaseNotesBody
          ? await normalizeReleaseNotes(
              parsedRelease.releaseNotesBody,
              parsedRelease.releaseNotesFormat ?? "html",
            )
          : null;
        const updatedNotesMarkdown = parsedRelease.releaseNotesBody
          ? (parsedNotesMarkdown ?? matchingRelease.releaseNotesMarkdown)
          : matchingRelease.releaseNotesMarkdown;
        const updatedNotesHtml = parsedRelease.releaseNotesBody
          ? parsedNotesMarkdown
            ? null
            : matchingRelease.releaseNotesHtml
          : matchingRelease.releaseNotesHtml;
        await db
          .update(releases)
          .set({
            status: "active",
            releasedAt: toISODate(parsedRelease.publishedAt) ?? matchingRelease.releasedAt,
            sourceConfidence: output.confidence,
            releaseNotesMarkdown: updatedNotesMarkdown,
            releaseNotesHtml: updatedNotesHtml,
            releaseNotesUrl: parsedRelease.releaseNotesUrl ?? matchingRelease.releaseNotesUrl,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(releases.id, releaseId));
      } else {
        releaseId = generateId(idPrefixes.release);
        const releaseNotesMarkdown = parsedRelease.releaseNotesBody
          ? await normalizeReleaseNotes(
              parsedRelease.releaseNotesBody,
              parsedRelease.releaseNotesFormat ?? "html",
            )
          : null;
        await db.insert(releases).values({
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
        });
      }

      observedReleaseIds.add(releaseId);

      // Insert observation
      await db.insert(releaseObservations).values({
        id: observationId,
        parserRunId,
        appId: source.appId,
        releaseId,
        observedVersionRaw: parsedRelease.versionRaw,
        observedVersionNormalized: versionNormalized,
        observedBuildNumber: parsedRelease.buildNumber ?? null,
        observedChannel: channel,
        observedPublishedAt: toISODate(parsedRelease.publishedAt),
        observedReleaseNotesUrl: parsedRelease.releaseNotesUrl ?? null,
        observedDownloadUrl: parsedRelease.downloadUrl ?? null,
        confidence: output.confidence,
        observationJson: parsedRelease.metadata ? JSON.stringify(parsedRelease.metadata) : null,
        createdAt: now,
      });

      // Upsert artifacts — query once, then insert only new URLs
      const existingArtifacts = await db
        .select({ id: artifacts.id, url: artifacts.url })
        .from(artifacts)
        .where(eq(artifacts.releaseId, releaseId))
        .all();
      const existingByUrl = new Map(existingArtifacts.map((a) => [a.url, a] as const));

      for (const parsedArtifact of parsedRelease.artifacts) {
        const architecture = normalizeArtifactArchitecture(parsedArtifact.architecture);
        const existingArtifact = existingByUrl.get(parsedArtifact.url);
        if (existingArtifact) {
          await db
            .update(artifacts)
            .set({
              sha256: parsedArtifact.sha256 ?? undefined,
              sizeBytes: parsedArtifact.sizeBytes ?? undefined,
              architecture,
              minOsVersion: parsedArtifact.minOsVersion ?? undefined,
            })
            .where(eq(artifacts.id, existingArtifact.id));
          continue;
        }
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
          await recordSourceAnomaly({
            db,
            sourceId: source.id,
            kind: "missing_install_hash",
            fingerprint: parsedArtifact.url,
            message: `Installable ${parsedArtifact.type} artifact is missing SHA-256: ${parsedArtifact.url}`,
            now,
          });
        }
        await db.insert(artifacts).values({
          id: generateId(idPrefixes.artifact),
          releaseId,
          artifactType: parsedArtifact.type,
          url: parsedArtifact.url,
          sha256: parsedArtifact.sha256 ?? null,
          sizeBytes: parsedArtifact.sizeBytes ?? null,
          architecture,
          minOsVersion: parsedArtifact.minOsVersion ?? null,
          isPrimary: false,
          createdAt: now,
        });
      }

      // Ensure exactly one primary artifact per release (prefer newest)
      const allReleaseArtifacts = await db
        .select({ id: artifacts.id })
        .from(artifacts)
        .where(eq(artifacts.releaseId, releaseId))
        .orderBy(desc(artifacts.createdAt))
        .all();
      const firstArtifact = allReleaseArtifacts[0];
      if (firstArtifact) {
        await db
          .update(artifacts)
          .set({ isPrimary: false })
          .where(eq(artifacts.releaseId, releaseId));
        await db
          .update(artifacts)
          .set({ isPrimary: true })
          .where(eq(artifacts.id, firstArtifact.id));
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

      let withdrawnCount = 0;
      for (const prior of priorReleases) {
        if (!observedReleaseIds.has(prior.id)) {
          await db
            .update(releases)
            .set({ status: "withdrawn", updatedAt: new Date().toISOString() })
            .where(eq(releases.id, prior.id));
          withdrawnCount++;
        }
      }
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
