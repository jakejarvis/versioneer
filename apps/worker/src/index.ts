import { WorkerEntrypoint } from "cloudflare:workers";
import { desc, eq, sql } from "drizzle-orm";

import { msElapsedSince } from "@versioneer/core/dates";
import { createLogger } from "@versioneer/core/logger";
import {
  handleSourceParse,
  handleRecomputeLatest,
  handleCaskIndexSync,
  enrichDiscoveredApp,
  isCaskSyncDue,
} from "@versioneer/core/pipeline";
import type { SourceParseJob, RecomputeLatestJob } from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import { cronJobRuns, discoveredApps, generateId, idPrefixes } from "@versioneer/db";
// Import parsers to trigger auto-registration
import "@versioneer/core/parsers";

// Re-export the Workflow class so wrangler can discover it
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
        log.info("poll sources completed", { queued, total: activeSources.length });
        await db.insert(cronJobRuns).values({
          id: runId,
          jobType: "poll_sources",
          trigger: "scheduled",
          status: "completed",
          itemsQueued: queued,
          itemsTotal: activeSources.length,
          startedAt,
          completedAt: new Date().toISOString(),
        });
      } catch (error) {
        log.error("poll sources job failed", { error });
        await db.insert(cronJobRuns).values({
          id: runId,
          jobType: "poll_sources",
          trigger: "scheduled",
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          startedAt,
          completedAt: new Date().toISOString(),
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
        }
      } catch (error) {
        log.error("cask index sync failed", { error });
        await db.insert(cronJobRuns).values({
          id: runId,
          jobType: "cask_index_sync",
          trigger: "scheduled",
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          startedAt,
          completedAt: new Date().toISOString(),
        });
      }
    }

    // --- Discovered App Enrichment (bounded best-effort batch) ---
    {
      const runId = generateId(idPrefixes.cronJobRun);
      const startedAt = new Date().toISOString();
      const maxBatchSize = 25;
      try {
        // Push all eligibility checks into SQL so only actionable rows are returned.
        // Priority: pending (never enriched) → failed (retry) → stuck in_progress → stale success.
        const candidates = await db
          .select({ id: discoveredApps.id })
          .from(discoveredApps)
          .where(
            sql`(${discoveredApps.status} = 'pending' OR ${discoveredApps.status} = 'linked')
              AND (
                ${discoveredApps.enrichmentStatus} IN ('pending', 'failed')
                OR (${discoveredApps.enrichmentStatus} = 'in_progress'
                    AND datetime(${discoveredApps.updatedAt}, '+15 minutes') <= datetime('now'))
                OR (${discoveredApps.enrichmentStatus} = 'success'
                    AND datetime(${discoveredApps.enrichedAt}, '+24 hours') <= datetime('now'))
              )`,
          )
          .orderBy(
            sql`CASE ${discoveredApps.enrichmentStatus}
              WHEN 'pending' THEN 0
              WHEN 'failed'  THEN 1
              WHEN 'in_progress' THEN 2
              ELSE 3
            END`,
            sql`COALESCE(${discoveredApps.enrichedAt}, '1970-01-01') ASC`,
            desc(discoveredApps.lastSeenAt),
          )
          .limit(maxBatchSize)
          .all();

        let enriched = 0;
        for (const candidate of candidates) {
          await enrichDiscoveredApp({
            discoveredAppId: candidate.id,
            db,
            githubToken: this.env.GITHUB_TOKEN,
            assetsBucket: this.env.RAW_BUCKET,
            configKv: this.env.CONFIG_KV,
          });
          enriched++;
        }

        if (candidates.length > 0) {
          log.info("enrichment batch completed", { enriched, candidates: candidates.length });
          await db.insert(cronJobRuns).values({
            id: runId,
            jobType: "enrich_discovered_apps",
            trigger: "scheduled",
            status: "completed",
            itemsQueued: enriched,
            itemsTotal: candidates.length,
            startedAt,
            completedAt: new Date().toISOString(),
          });
        }
      } catch (error) {
        log.error("enrichment batch failed", { error });
        await db.insert(cronJobRuns).values({
          id: runId,
          jobType: "enrich_discovered_apps",
          trigger: "scheduled",
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          startedAt,
          completedAt: new Date().toISOString(),
        });
      }
    }
  }
}
