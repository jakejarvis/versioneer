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
import { and, desc, eq } from "drizzle-orm";

import { createLogger } from "../logger";
import { getParser } from "../parsers";
import { normalizeVersion, inferChannel } from "../versioning";
import { normalizeReleaseNotes } from "./release-notes";
import type { Env, ParseStepResult, SourceParseJob } from "./types";

/** Convert any parseable date string (RFC 2822, ISO 8601, etc.) to ISO 8601. */
function toISODate(dateStr: string | undefined | null): string | null {
  if (!dateStr) return null;
  const ms = new Date(dateStr).getTime();
  if (Number.isNaN(ms)) return null;
  return new Date(ms).toISOString();
}

export async function handleSourceParse(job: SourceParseJob, env: Env): Promise<ParseStepResult> {
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
      return { appId: source.appId, releaseCount: 0 };
    }
  }

  try {
    const output = parser.parse(body, {
      ...config,
      sourceBaseUrl: source.baseUrl,
    });

    // Insert parser run
    await db.insert(parserRuns).values({
      id: parserRunId,
      sourceFetchId: fetchRecord.id,
      parserKey: source.parserKey,
      parserVersion: output.parserVersion,
      runStatus:
        output.errors.length > 0 && output.releases.length > 0
          ? "partial"
          : output.releases.length > 0
            ? "success"
            : "error",
      observationCount: output.releases.length,
      confidence: output.confidence,
      errorMessage: output.errors.length > 0 ? output.errors.join("; ") : null,
      startedAt: now,
      finishedAt: new Date().toISOString(),
    });

    if (output.errors.length > 0) {
      log.warn("parse had errors", {
        parserKey: source.parserKey,
        releaseCount: output.releases.length,
        errors: output.errors,
      });
    }

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
        // Update if we have newer info
        const updatedNotesHtml = parsedRelease.releaseNotesBody
          ? normalizeReleaseNotes(
              parsedRelease.releaseNotesBody,
              parsedRelease.releaseNotesFormat ?? "html",
            )
          : matchingRelease.releaseNotesHtml;
        await db
          .update(releases)
          .set({
            releasedAt: toISODate(parsedRelease.publishedAt) ?? matchingRelease.releasedAt,
            sourceConfidence: output.confidence,
            releaseNotesHtml: updatedNotesHtml,
            releaseNotesUrl: parsedRelease.releaseNotesUrl ?? matchingRelease.releaseNotesUrl,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(releases.id, releaseId));
      } else {
        releaseId = generateId(idPrefixes.release);
        await db.insert(releases).values({
          id: releaseId,
          appId: source.appId,
          versionRaw: parsedRelease.versionRaw,
          versionNormalized,
          buildNumber: parsedRelease.buildNumber ?? null,
          channel,
          releasedAt: toISODate(parsedRelease.publishedAt),
          isPrerelease: parsedRelease.isPrerelease,
          sourceConfidence: output.confidence,
          publishedBySourceId: source.id,
          releaseNotesHtml: parsedRelease.releaseNotesBody
            ? normalizeReleaseNotes(
                parsedRelease.releaseNotesBody,
                parsedRelease.releaseNotesFormat ?? "html",
              )
            : null,
          releaseNotesUrl: parsedRelease.releaseNotesUrl ?? null,
          status: "active",
          createdAt: now,
          updatedAt: now,
        });
      }

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
      const existingUrls = new Set(existingArtifacts.map((a) => a.url));

      for (const parsedArtifact of parsedRelease.artifacts) {
        if (existingUrls.has(parsedArtifact.url)) continue;
        await db.insert(artifacts).values({
          id: generateId(idPrefixes.artifact),
          releaseId,
          artifactType: parsedArtifact.type,
          url: parsedArtifact.url,
          sha256: parsedArtifact.sha256 ?? null,
          sizeBytes: parsedArtifact.sizeBytes ?? null,
          architecture: parsedArtifact.architecture ?? null,
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

    throw error;
  }
}
