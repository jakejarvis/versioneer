import { WorkerEntrypoint } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import { msElapsedSince } from "@versioneer/core/dates";
import { createLogger } from "@versioneer/core/logger";
import {
  handleSourceParse,
  handleRecomputeLatest,
  handleCaskIndexSync,
  isCaskSyncDue,
  recordJobFailure,
  resolveJobFailure,
} from "@versioneer/core/pipeline";
import type { SourceParseJob, RecomputeLatestJob } from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import { cronJobRuns, generateId, idPrefixes } from "@versioneer/db";
// Import parsers to trigger auto-registration
import "@versioneer/core/parsers";
import { runEnrichmentBatch } from "./enrichment";

// Re-export the Workflow class so wrangler can discover it
export { EnrichmentDrainWorkflow } from "./workflows/enrichment-drain";
export { SourcePipelineWorkflow } from "./workflows/source-pipeline";

const SOURCE_PIPELINE_BATCH_SIZE = 100;

type SourcePipelineBinding = Env["SOURCE_PIPELINE"];
type SourcePipelineCreateOptions = NonNullable<Parameters<SourcePipelineBinding["create"]>[0]>;
type Logger = ReturnType<typeof createLogger>;

async function createSourcePipelineBatch(
  sourcePipeline: SourcePipelineBinding,
  jobs: SourcePipelineCreateOptions[],
  log: Logger,
): Promise<number> {
  let queued = 0;

  for (let index = 0; index < jobs.length; index += SOURCE_PIPELINE_BATCH_SIZE) {
    const chunk = jobs.slice(index, index + SOURCE_PIPELINE_BATCH_SIZE);
    try {
      const instances = await sourcePipeline.createBatch(chunk);
      queued += instances.length;
    } catch (error) {
      log.error("failed to queue source pipeline batch", { batchSize: chunk.length, error });
      for (const job of chunk) {
        try {
          await sourcePipeline.create(job);
          queued++;
        } catch (sourceError) {
          log.error("failed to queue source pipeline", {
            sourceId: job.params?.sourceId,
            error: sourceError,
          });
        }
      }
    }
  }

  return queued;
}

export default class PipelineWorker extends WorkerEntrypoint {
  /**
   * RPC: recompute the latest release for an app (optionally a specific channel).
   * Called via service binding from the dashboard.
   */
  async recomputeLatest(params: RecomputeLatestJob): Promise<void> {
    await handleRecomputeLatest(params, this.env);
  }

  /**
   * RPC: re-parse an existing source fetch.
   * Called via service binding from the dashboard.
   */
  async reparse(params: SourceParseJob): Promise<void> {
    await handleSourceParse(params, this.env);
    // Also recompute after reparse, since that's the pipeline contract
    const db = createDb(this.env.DB);
    const { sourceFetches, sources } = await import("@versioneer/db");
    const fetch = await db
      .select({ sourceId: sourceFetches.sourceId })
      .from(sourceFetches)
      .where(eq(sourceFetches.id, params.sourceFetchId))
      .get();
    if (fetch) {
      const source = await db
        .select({ appId: sources.appId })
        .from(sources)
        .where(eq(sources.id, fetch.sourceId))
        .get();
      if (source) {
        await handleRecomputeLatest({ appId: source.appId }, this.env);
      }
    }
  }

  /**
   * Cron-triggered handler: polls sources and runs cask index sync.
   */
  async scheduled(_event: ScheduledEvent): Promise<void> {
    const db = createDb(this.env.DB);
    const { sources } = await import("@versioneer/db");
    const log = createLogger({ handler: "scheduled" });

    const now = new Date();

    // --- Poll Sources ---
    {
      const runId = generateId(idPrefixes.cronJobRun);
      const startedAt = new Date().toISOString();
      try {
        const activeSources = await db
          .select()
          .from(sources)
          .where(eq(sources.status, "active"))
          .all();
        const jobs: SourcePipelineCreateOptions[] = [];
        for (const source of activeSources) {
          const elapsed = msElapsedSince(source.lastFetchedAt, now.getTime());
          const intervalMs = source.pollIntervalMinutes * 60 * 1000;
          if (elapsed === null || elapsed >= intervalMs) {
            jobs.push({
              params: {
                sourceId: source.id,
                reason: "scheduled",
                force: false,
              },
            });
          }
        }
        const queued = await createSourcePipelineBatch(this.env.SOURCE_PIPELINE, jobs, log);
        const status = queued === jobs.length ? "completed" : "failed";
        const errorMessage =
          status === "failed"
            ? `${jobs.length - queued} source workflow${jobs.length - queued === 1 ? "" : "s"} failed to queue`
            : null;
        log.info("poll sources completed", { queued, total: activeSources.length, status });
        await db.insert(cronJobRuns).values({
          id: runId,
          jobType: "poll_sources",
          trigger: "scheduled",
          status,
          itemsQueued: queued,
          itemsTotal: activeSources.length,
          errorMessage,
          startedAt,
          completedAt: new Date().toISOString(),
        });
        if (status === "failed" && errorMessage) {
          await recordJobFailure({
            db,
            jobType: "poll_sources",
            relatedId: null,
            jobKey: "scheduled",
            errorMessage,
          });
        } else {
          await resolveJobFailure({
            db,
            jobType: "poll_sources",
            relatedId: null,
            jobKey: "scheduled",
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error("poll sources job failed", { error });
        await db.insert(cronJobRuns).values({
          id: runId,
          jobType: "poll_sources",
          trigger: "scheduled",
          status: "failed",
          errorMessage,
          startedAt,
          completedAt: new Date().toISOString(),
        });
        await recordJobFailure({
          db,
          jobType: "poll_sources",
          relatedId: null,
          jobKey: "scheduled",
          errorMessage,
        });
      }
    }

    // --- Cask Index Sync (runs directly, no queue hop) ---
    {
      const runId = generateId(idPrefixes.cronJobRun);
      const startedAt = new Date().toISOString();
      try {
        if (await isCaskSyncDue(this.env)) {
          await handleCaskIndexSync({ reason: "scheduled", force: false }, this.env);
          await db.insert(cronJobRuns).values({
            id: runId,
            jobType: "cask_index_sync",
            trigger: "scheduled",
            status: "completed",
            itemsQueued: 1,
            startedAt,
            completedAt: new Date().toISOString(),
          });
          await resolveJobFailure({
            db,
            jobType: "cask_index_sync",
            relatedId: null,
            jobKey: "scheduled",
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error("cask index sync failed", { error });
        await db.insert(cronJobRuns).values({
          id: runId,
          jobType: "cask_index_sync",
          trigger: "scheduled",
          status: "failed",
          errorMessage,
          startedAt,
          completedAt: new Date().toISOString(),
        });
        await recordJobFailure({
          db,
          jobType: "cask_index_sync",
          relatedId: null,
          jobKey: "scheduled",
          errorMessage,
        });
      }
    }

    // --- Discovered App Enrichment (bounded best-effort batch) ---
    {
      const runId = generateId(idPrefixes.cronJobRun);
      const startedAt = new Date().toISOString();
      try {
        const batch = await runEnrichmentBatch({ db, env: this.env });

        if (batch.candidateCount > 0) {
          log.info("enrichment batch completed", {
            enriched: batch.succeeded,
            failed: batch.failed,
            candidates: batch.candidateCount,
          });
          await db.insert(cronJobRuns).values({
            id: runId,
            jobType: "enrich_discovered_apps",
            trigger: "scheduled",
            status: "completed",
            itemsQueued: batch.succeeded,
            itemsTotal: batch.attempted,
            resultJson: JSON.stringify(batch),
            startedAt,
            completedAt: new Date().toISOString(),
          });
          await resolveJobFailure({
            db,
            jobType: "enrich_discovered_apps",
            relatedId: null,
            jobKey: "scheduled",
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error("enrichment batch failed", { error });
        await db.insert(cronJobRuns).values({
          id: runId,
          jobType: "enrich_discovered_apps",
          trigger: "scheduled",
          status: "failed",
          errorMessage,
          startedAt,
          completedAt: new Date().toISOString(),
        });
        await recordJobFailure({
          db,
          jobType: "enrich_discovered_apps",
          relatedId: null,
          jobKey: "scheduled",
          errorMessage,
        });
      }
    }
  }
}
