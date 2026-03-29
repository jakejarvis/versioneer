import {
  handleSourceParse,
  handleRecomputeLatest,
  handleCaskIndexSync,
  isCaskSyncDue,
} from "@versioneer/core/pipeline";
import type { SourceParseJob, RecomputeLatestJob } from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import { cronJobRuns, generateId, idPrefixes } from "@versioneer/db";
import { WorkerEntrypoint } from "cloudflare:workers";
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
    const { eq } = await import("drizzle-orm");
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
    const { eq } = await import("drizzle-orm");

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
          const lastFetched = source.lastFetchedAt ? new Date(source.lastFetchedAt) : null;
          const intervalMs = source.pollIntervalMinutes * 60 * 1000;
          if (!lastFetched || now.getTime() - lastFetched.getTime() >= intervalMs) {
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
              console.error(`Failed to create pipeline for source ${source.id}:`, error);
            }
          }
        }
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
        console.error("Poll sources scheduled job failed:", error);
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
        console.error("Cask index sync scheduled job failed:", error);
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
  }
}
