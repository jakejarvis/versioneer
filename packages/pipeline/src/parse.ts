import { createDb } from "@versioneer/db";
import { getParser } from "@versioneer/parsers";
import {
  sourceFetches,
  sources,
  parserRuns,
  releaseObservations,
  releases,
  artifacts,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { normalizeVersion, inferChannel } from "@versioneer/versioning";
import { eq } from "drizzle-orm";

import { incrementHealthMetric } from "./health";
import { normalizeReleaseNotes } from "./release-notes";
import type { Env, SourceParseJob } from "./types";

export async function handleSourceParse(job: SourceParseJob, env: Env): Promise<void> {
  const db = createDb(env.DB);
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
    return; // Nothing to parse
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
  const config = source.configJson ? JSON.parse(source.configJson) : undefined;

  try {
    const output = parser.parse(body, config);

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

    // Process each parsed release
    for (const parsedRelease of output.releases) {
      const observationId = generateId(idPrefixes.releaseObservation);
      const versionNormalized = normalizeVersion(parsedRelease.versionRaw);
      const channel = parsedRelease.channel || inferChannel(parsedRelease.versionRaw);

      // Upsert release: check if version already exists for this app
      let releaseId: string | undefined;
      const existingRelease = await db
        .select()
        .from(releases)
        .where(eq(releases.appId, source.appId))
        .all();

      const matchingRelease = existingRelease.find(
        (r) => r.versionNormalized === versionNormalized && r.channel === channel,
      );

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
            releasedAt: parsedRelease.publishedAt ?? matchingRelease.releasedAt,
            sourceConfidence: output.confidence,
            releaseNotesHtml: updatedNotesHtml,
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
          releasedAt: parsedRelease.publishedAt ?? null,
          isPrerelease: parsedRelease.isPrerelease,
          sourceConfidence: output.confidence,
          releaseNotesHtml: parsedRelease.releaseNotesBody
            ? normalizeReleaseNotes(
                parsedRelease.releaseNotesBody,
                parsedRelease.releaseNotesFormat ?? "html",
              )
            : null,
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
        observedPublishedAt: parsedRelease.publishedAt ?? null,
        observedReleaseNotesUrl: parsedRelease.releaseNotesUrl ?? null,
        observedDownloadUrl: parsedRelease.downloadUrl ?? null,
        confidence: output.confidence,
        observationJson: parsedRelease.metadata ? JSON.stringify(parsedRelease.metadata) : null,
        createdAt: now,
      });

      // Upsert artifacts
      for (const parsedArtifact of parsedRelease.artifacts) {
        // Check if artifact URL already exists for this release
        const existingArtifacts = await db
          .select()
          .from(artifacts)
          .where(eq(artifacts.releaseId, releaseId))
          .all();

        const existing = existingArtifacts.find((a) => a.url === parsedArtifact.url);
        if (!existing) {
          const artifactId = generateId(idPrefixes.artifact);
          await db.insert(artifacts).values({
            id: artifactId,
            releaseId,
            artifactType: parsedArtifact.type,
            url: parsedArtifact.url,
            sha256: parsedArtifact.sha256 ?? null,
            sizeBytes: parsedArtifact.sizeBytes ?? null,
            architecture: parsedArtifact.architecture ?? null,
            minOsVersion: parsedArtifact.minOsVersion ?? null,
            isPrimary: parsedRelease.artifacts.indexOf(parsedArtifact) === 0,
            createdAt: now,
          });
        }
      }
    }

    // Track health metric: parse success
    await incrementHealthMetric(db, source.id, "parseAttempts");
    await incrementHealthMetric(
      db,
      source.id,
      output.errors.length > 0 && output.releases.length > 0 ? "parseSuccesses" : "parseSuccesses",
    );

    // Enqueue recompute-latest
    await env.RECOMPUTE_LATEST_QUEUE.send({
      appId: source.appId,
    });
  } catch (error) {
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

    // Track health metric: parse failure
    await incrementHealthMetric(db, source.id, "parseAttempts");
    await incrementHealthMetric(db, source.id, "parseFailures");

    throw error;
  }
}
