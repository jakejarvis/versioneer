import { msElapsedSince } from "@versioneer/core/dates";
import { createLogger } from "@versioneer/core/logger";
import {
  handleSourceParse,
  handleRecomputeLatest,
  handleCaskIndexSync,
  enrichDiscoveredApp,
  isCaskSyncDue,
  shouldEnrich,
} from "@versioneer/core/pipeline";
import type { SourceParseJob, RecomputeLatestJob } from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import { cronJobRuns, discoveredApps, generateId, idPrefixes } from "@versioneer/db";
import { WorkerEntrypoint } from "cloudflare:workers";
import { desc, eq, or } from "drizzle-orm";
// Import parsers to trigger auto-registration
import "@versioneer/core/parsers";

// Re-export the Workflow class so wrangler can discover it
export { SourcePipelineWorkflow } from "./workflows/source-pipeline";

export default class PipelineWorker extends WorkerEntrypoint<Env> {
  /**
   * RPC: recompute the latest release for an app (optionally a specific channel).
   * Called via service binding from the dashboard.
   */
  async recomputeLatest(params: RecomputeLatestJob): Promise<void> {
    await handleRecomputeLatest(params, this.env as never);
  }

  /**
   * RPC: re-parse an existing source fetch.
   * Called via service binding from the dashboard.
   */
  async reparse(params: SourceParseJob): Promise<void> {
    await handleSourceParse(params, this.env as never);
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
        await handleRecomputeLatest({ appId: source.appId }, this.env as never);
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
        let queued = 0;
        for (const source of activeSources) {
          const elapsed = msElapsedSince(source.lastFetchedAt, now.getTime());
          const intervalMs = source.pollIntervalMinutes * 60 * 1000;
          if (elapsed === null || elapsed >= intervalMs) {
            try {
              await this.env.SOURCE_PIPELINE.create({
                params: {
                  sourceId: source.id,
                  reason: "scheduled",
                  force: false,
                },
              });
              queued++;
            } catch (error) {
              log.error("failed to queue source pipeline", { sourceId: source.id, error });
            }
          }
        }
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
        if (await isCaskSyncDue(this.env as never)) {
          await handleCaskIndexSync({ reason: "scheduled", force: false }, this.env as never);
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
      const maxBatchSize = 10;
      try {
        const ENRICHMENT_STUCK_MS = 15 * 60 * 1000; // 15 minutes
        const candidates = await db
          .select({
            id: discoveredApps.id,
            enrichmentStatus: discoveredApps.enrichmentStatus,
            enrichedAt: discoveredApps.enrichedAt,
            updatedAt: discoveredApps.updatedAt,
          })
          .from(discoveredApps)
          .where(or(eq(discoveredApps.status, "pending"), eq(discoveredApps.status, "linked")))
          .orderBy(desc(discoveredApps.lastSeenAt))
          .limit(50)
          .all();

        let enriched = 0;
        for (const candidate of candidates) {
          // Skip in_progress unless stuck for >15 minutes (crash recovery)
          if (candidate.enrichmentStatus === "in_progress") {
            const age = msElapsedSince(candidate.updatedAt);
            if (age !== null && age < ENRICHMENT_STUCK_MS) continue;
          } else if (!shouldEnrich(candidate)) {
            continue;
          }

          await enrichDiscoveredApp({
            discoveredAppId: candidate.id,
            db,
            githubToken: this.env.GITHUB_TOKEN,
            assetsBucket: this.env.RAW_BUCKET,
            configKv: this.env.CONFIG_KV,
          });

          enriched++;
          if (enriched >= maxBatchSize) break;
        }

        if (enriched > 0) {
          log.info("enrichment batch completed", { enriched, candidates: candidates.length });
        }
      } catch (error) {
        log.error("enrichment batch failed", { error });
      }
    }
  }
}
