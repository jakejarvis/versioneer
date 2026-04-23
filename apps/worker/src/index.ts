import { WorkerEntrypoint } from "cloudflare:workers";
import { and, eq, isNull, lte, or } from "drizzle-orm";

import { createLogger } from "@versioneer/core/logger";
import { captureServerEvent, captureServerException } from "@versioneer/core/observability";
import {
  handleSourceParse,
  handleRecomputeLatest,
  handleCaskIndexSync,
  isCaskSyncDue,
  recordJobFailure,
  resolveJobFailure,
  inventoryFollowupQueueMessageSchema,
} from "@versioneer/core/pipeline";
import type {
  InventoryFollowupQueueMessage,
  SourceParseJob,
  RecomputeLatestJob,
} from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import { cronJobRuns, generateId, idPrefixes } from "@versioneer/db";
// Import parsers to trigger auto-registration
import "@versioneer/core/parsers";
import { runEnrichmentBatch } from "./enrichment";
import {
  claimInventoryFollowupJob,
  INVENTORY_FOLLOWUP_RETRY_DELAY_SECONDS,
  markInventoryFollowupQueueFailure,
  repairInventoryFollowupQueue,
} from "./inventory-followup-queue";
import {
  createSourcePipelineBatch,
  updateNextPollAtForQueuedSources,
} from "./source-pipeline-queue";

// Re-export the Workflow class so wrangler can discover it
export { EnrichmentDrainWorkflow } from "./workflows/enrichment-drain";
export { InventoryFollowupWorkflow } from "./workflows/inventory-followup";
export { SourcePipelineWorkflow } from "./workflows/source-pipeline";

type SourcePipelineBinding = Env["SOURCE_PIPELINE"];
type SourcePipelineCreateOptions = NonNullable<Parameters<SourcePipelineBinding["create"]>[0]>;
export { repairInventoryFollowupQueue } from "./inventory-followup-queue";

export default class PipelineWorker extends WorkerEntrypoint {
  private captureWorkerEvent(event: string, properties: Record<string, unknown> = {}) {
    this.ctx.waitUntil(
      captureServerEvent(this.env, {
        event,
        properties: {
          surface: "worker",
          ...properties,
        },
      }),
    );
  }

  private captureWorkerException(error: unknown, properties: Record<string, unknown> = {}) {
    this.ctx.waitUntil(
      captureServerException(this.env, {
        error,
        properties: {
          surface: "worker",
          ...properties,
        },
      }),
    );
  }

  /**
   * RPC: recompute the latest release for an app (optionally a specific channel).
   * Called via service binding from the dashboard.
   */
  async recomputeLatest(params: RecomputeLatestJob): Promise<void> {
    try {
      await handleRecomputeLatest(params, this.env);
      this.captureWorkerEvent("worker_recompute_latest_completed", {
        target_type: "app",
        target_id: params.appId,
        channel: params.channel ?? null,
        status: "completed",
      });
    } catch (error) {
      this.captureWorkerException(error, {
        handler: "recomputeLatest",
        target_type: "app",
        target_id: params.appId,
        channel: params.channel ?? null,
        status: "failed",
      });
      throw error;
    }
  }

  /**
   * RPC: re-parse an existing source fetch.
   * Called via service binding from the dashboard.
   */
  async reparse(params: SourceParseJob): Promise<void> {
    try {
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
      this.captureWorkerEvent("worker_source_reparse_completed", {
        target_type: "source_fetch",
        target_id: params.sourceFetchId,
        status: "completed",
      });
    } catch (error) {
      this.captureWorkerException(error, {
        handler: "reparse",
        target_type: "source_fetch",
        target_id: params.sourceFetchId,
        status: "failed",
      });
      throw error;
    }
  }

  /**
   * RPC: re-enqueue a durable inventory follow-up job.
   * Called via service binding from the dashboard failure queue.
   */
  async retryInventoryFollowup(params: InventoryFollowupQueueMessage): Promise<void> {
    const message = inventoryFollowupQueueMessageSchema.parse(params);
    try {
      await this.env.INVENTORY_FOLLOWUP_QUEUE.send(message);
      this.captureWorkerEvent("worker_inventory_followup_retry_queued", {
        target_type: "inventory_followup_job",
        target_id: message.jobId,
        status: "queued",
      });
    } catch (error) {
      this.captureWorkerException(error, {
        handler: "retryInventoryFollowup",
        target_type: "inventory_followup_job",
        target_id: message.jobId,
        status: "failed",
      });
      throw error;
    }
  }

  async queue(batch: MessageBatch<InventoryFollowupQueueMessage>): Promise<void> {
    const db = createDb(this.env.DB);
    const log = createLogger({ handler: "inventory_followup_queue", queue: batch.queue });

    for (const message of batch.messages) {
      const parsed = inventoryFollowupQueueMessageSchema.safeParse(message.body);
      if (!parsed.success) {
        log.error("invalid inventory follow-up queue message", {
          messageId: message.id,
          issues: parsed.error.issues,
        });
        message.ack();
        continue;
      }

      const { jobId } = parsed.data;
      try {
        const now = new Date().toISOString();
        const claim = await claimInventoryFollowupJob({ db, jobId, now });
        if (claim.status === "skipped") {
          if (claim.reason === "missing-job") {
            await recordJobFailure({
              db,
              jobType: "inventory_followup",
              relatedId: jobId,
              jobKey: "queue",
              errorMessage: `Inventory follow-up job ${jobId} does not exist`,
            });
          }
          log.info("inventory follow-up queue message skipped", {
            jobId,
            reason: claim.reason,
          });
          message.ack();
          continue;
        }

        await this.env.INVENTORY_FOLLOWUP.create(claim.createOptions);
        await resolveJobFailure({
          db,
          jobType: "inventory_followup",
          relatedId: jobId,
          jobKey: "queue",
        });
        log.info("inventory follow-up workflow queued", {
          jobId,
          attemptCount: claim.attemptCount,
          workflowInstanceId: claim.workflowInstanceId,
        });
        this.captureWorkerEvent("worker_inventory_followup_queued", {
          target_type: "inventory_followup_job",
          target_id: jobId,
          attempt_count: claim.attemptCount,
          workflow_instance_id: claim.workflowInstanceId,
          status: "queued",
        });
        message.ack();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error("failed to start inventory follow-up workflow", { jobId, error });
        try {
          await markInventoryFollowupQueueFailure({
            db,
            jobId,
            errorMessage,
            now: new Date().toISOString(),
          });
        } catch (markError) {
          log.error("failed to mark inventory follow-up queue failure", { jobId, markError });
        }
        this.captureWorkerException(error, {
          handler: "inventory_followup_queue",
          target_type: "inventory_followup_job",
          target_id: jobId,
          status: "failed",
        });
        message.retry({ delaySeconds: INVENTORY_FOLLOWUP_RETRY_DELAY_SECONDS });
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

    // --- Inventory Follow-up Queue Repair ---
    {
      try {
        const repaired = await repairInventoryFollowupQueue({
          db,
          queue: this.env.INVENTORY_FOLLOWUP_QUEUE,
          log,
          now,
        });
        if (repaired > 0) {
          log.info("inventory follow-up repair enqueued jobs", { repaired });
        }
      } catch (error) {
        log.error("inventory follow-up repair failed", { error });
        this.captureWorkerException(error, {
          handler: "inventory_followup_repair",
          status: "failed",
        });
      }
    }

    // --- Poll Sources ---
    {
      const runId = generateId(idPrefixes.cronJobRun);
      const startedAt = new Date().toISOString();
      try {
        const nowIso = now.toISOString();
        const dueSources = await db
          .select({ id: sources.id, pollIntervalMinutes: sources.pollIntervalMinutes })
          .from(sources)
          .where(
            and(
              eq(sources.status, "active"),
              or(isNull(sources.nextPollAt), lte(sources.nextPollAt, nowIso)),
            ),
          )
          .all();
        const jobs: SourcePipelineCreateOptions[] = dueSources.map((source) => ({
          params: {
            sourceId: source.id,
            reason: "scheduled",
            force: false,
          },
        }));
        const queued = await createSourcePipelineBatch(this.env.SOURCE_PIPELINE, jobs, log);
        if (queued === jobs.length && dueSources.length > 0) {
          await updateNextPollAtForQueuedSources({ db, dueSources, nowIso });
        }
        const status = queued === jobs.length ? "completed" : "failed";
        const errorMessage =
          status === "failed"
            ? `${jobs.length - queued} source workflow${jobs.length - queued === 1 ? "" : "s"} failed to queue`
            : null;
        log.info("poll sources completed", { queued, total: dueSources.length, status });
        await db.insert(cronJobRuns).values({
          id: runId,
          jobType: "poll_sources",
          trigger: "scheduled",
          status,
          itemsQueued: queued,
          itemsTotal: dueSources.length,
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
        this.captureWorkerEvent("worker_poll_sources_completed", {
          target_type: "cron_job",
          target_id: runId,
          job_type: "poll_sources",
          status,
          items_queued: queued,
          items_total: dueSources.length,
        });
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
        this.captureWorkerException(error, {
          handler: "scheduled",
          target_type: "cron_job",
          target_id: runId,
          job_type: "poll_sources",
          status: "failed",
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
          this.captureWorkerEvent("worker_cask_index_sync_completed", {
            target_type: "cron_job",
            target_id: runId,
            job_type: "cask_index_sync",
            status: "completed",
            items_queued: 1,
            items_total: 1,
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
        this.captureWorkerException(error, {
          handler: "scheduled",
          target_type: "cron_job",
          target_id: runId,
          job_type: "cask_index_sync",
          status: "failed",
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
          this.captureWorkerEvent("worker_enrichment_batch_completed", {
            target_type: "cron_job",
            target_id: runId,
            job_type: "enrich_discovered_apps",
            status: "completed",
            attempted: batch.attempted,
            succeeded: batch.succeeded,
            failed: batch.failed,
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
        this.captureWorkerException(error, {
          handler: "scheduled",
          target_type: "cron_job",
          target_id: runId,
          job_type: "enrich_discovered_apps",
          status: "failed",
        });
      }
    }
  }
}
