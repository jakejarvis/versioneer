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
  inventoryIngestionQueueMessageSchema,
} from "@versioneer/core/pipeline";
import type {
  InventoryIngestionQueueMessage,
  SourceParseJob,
  RecomputeLatestJob,
} from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import { cronJobRuns, generateId, idPrefixes } from "@versioneer/db";
// Import parsers to trigger auto-registration
import "@versioneer/core/parsers";
import { runEnrichmentBatch } from "./enrichment";
import {
  claimInventoryIngestionJob,
  INVENTORY_INGESTION_RETRY_DELAY_SECONDS,
  markInventoryIngestionQueueFailure,
  repairInventoryIngestionQueue,
} from "./inventory-ingestion-queue";
import {
  createSourcePipelineBatch,
  updateNextPollAtForQueuedSources,
} from "./source-pipeline-queue";

// Re-export the Workflow class so wrangler can discover it
export { EnrichmentDrainWorkflow } from "./workflows/enrichment-drain";
export { InventoryIngestionWorkflow } from "./workflows/inventory-ingestion";
export { SourcePipelineWorkflow } from "./workflows/source-pipeline";

type SourcePipelineBinding = Env["SOURCE_PIPELINE"];
type SourcePipelineCreateOptions = NonNullable<Parameters<SourcePipelineBinding["create"]>[0]>;
export { repairInventoryIngestionQueue } from "./inventory-ingestion-queue";

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
   * RPC: re-enqueue a durable inventory ingestion.
   * Called via service binding from the dashboard failure queue.
   */
  async retryInventoryIngestion(params: InventoryIngestionQueueMessage): Promise<void> {
    const message = inventoryIngestionQueueMessageSchema.parse(params);
    try {
      await this.env.INVENTORY_INGESTION_QUEUE.send(message);
      this.captureWorkerEvent("worker_inventory_ingestion_retry_queued", {
        target_type: "inventory_ingestion_job",
        target_id: message.ingestionId,
        status: "queued",
      });
    } catch (error) {
      this.captureWorkerException(error, {
        handler: "retryInventoryIngestion",
        target_type: "inventory_ingestion_job",
        target_id: message.ingestionId,
        status: "failed",
      });
      throw error;
    }
  }

  async queue(batch: MessageBatch<InventoryIngestionQueueMessage>): Promise<void> {
    const db = createDb(this.env.DB);
    const log = createLogger({ handler: "inventory_ingestion_queue", queue: batch.queue });

    for (const message of batch.messages) {
      const parsed = inventoryIngestionQueueMessageSchema.safeParse(message.body);
      if (!parsed.success) {
        log.error("invalid inventory ingestion queue message", {
          messageId: message.id,
          issues: parsed.error.issues,
        });
        message.ack();
        continue;
      }

      const { ingestionId } = parsed.data;
      try {
        const now = new Date().toISOString();
        const claim = await claimInventoryIngestionJob({ db, ingestionId, now });
        if (claim.status === "skipped") {
          if (claim.reason === "missing-job") {
            await recordJobFailure({
              db,
              jobType: "inventory_ingestion",
              relatedId: ingestionId,
              jobKey: "queue",
              errorMessage: `Inventory ingestion ${ingestionId} does not exist`,
            });
          }
          log.info("inventory ingestion queue message skipped", {
            ingestionId,
            reason: claim.reason,
          });
          message.ack();
          continue;
        }

        await this.env.INVENTORY_INGESTION.create(claim.createOptions);
        await resolveJobFailure({
          db,
          jobType: "inventory_ingestion",
          relatedId: ingestionId,
          jobKey: "queue",
        });
        log.info("inventory ingestion workflow queued", {
          ingestionId,
          attemptCount: claim.attemptCount,
          workflowInstanceId: claim.workflowInstanceId,
        });
        this.captureWorkerEvent("worker_inventory_ingestion_queued", {
          target_type: "inventory_ingestion_job",
          target_id: ingestionId,
          attempt_count: claim.attemptCount,
          workflow_instance_id: claim.workflowInstanceId,
          status: "queued",
        });
        message.ack();
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error("failed to start inventory ingestion workflow", { ingestionId, error });
        try {
          await markInventoryIngestionQueueFailure({
            db,
            ingestionId,
            errorMessage,
            now: new Date().toISOString(),
          });
        } catch (markError) {
          log.error("failed to mark inventory ingestion queue failure", {
            ingestionId,
            markError,
          });
        }
        this.captureWorkerException(error, {
          handler: "inventory_ingestion_queue",
          target_type: "inventory_ingestion_job",
          target_id: ingestionId,
          status: "failed",
        });
        message.retry({ delaySeconds: INVENTORY_INGESTION_RETRY_DELAY_SECONDS });
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

    // --- Inventory Ingestion Queue Repair ---
    {
      try {
        const repaired = await repairInventoryIngestionQueue({
          db,
          queue: this.env.INVENTORY_INGESTION_QUEUE,
          log,
          now,
        });
        if (repaired > 0) {
          log.info("inventory ingestion repair enqueued jobs", { repaired });
        }
      } catch (error) {
        log.error("inventory ingestion repair failed", { error });
        this.captureWorkerException(error, {
          handler: "inventory_ingestion_repair",
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
