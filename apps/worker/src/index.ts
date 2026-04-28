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

function elapsedMs(startedAtMs: number): number {
  return Date.now() - startedAtMs;
}

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
    const startedAtMs = Date.now();
    const log = createLogger({ handler: "recomputeLatest", appId: params.appId });
    log.info("recompute latest started", { channel: params.channel ?? null });
    try {
      await handleRecomputeLatest(params, this.env);
      log.info("recompute latest completed", {
        channel: params.channel ?? null,
        durationMs: elapsedMs(startedAtMs),
      });
      this.captureWorkerEvent("worker_recompute_latest_completed", {
        target_type: "app",
        target_id: params.appId,
        channel: params.channel ?? null,
        status: "completed",
      });
    } catch (error) {
      log.error("recompute latest failed", {
        channel: params.channel ?? null,
        durationMs: elapsedMs(startedAtMs),
        error,
      });
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
    const startedAtMs = Date.now();
    const log = createLogger({ handler: "reparse", sourceFetchId: params.sourceFetchId });
    log.info("source reparse started");
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
          log.info("source reparse recompute started", {
            sourceId: fetch.sourceId,
            appId: source.appId,
          });
          await handleRecomputeLatest({ appId: source.appId }, this.env);
          log.info("source reparse recompute completed", {
            sourceId: fetch.sourceId,
            appId: source.appId,
          });
        } else {
          log.warn("source reparse skipped recompute because source was missing", {
            sourceId: fetch.sourceId,
          });
        }
      } else {
        log.warn("source reparse skipped recompute because source fetch was missing");
      }
      log.info("source reparse completed", { durationMs: elapsedMs(startedAtMs) });
      this.captureWorkerEvent("worker_source_reparse_completed", {
        target_type: "source_fetch",
        target_id: params.sourceFetchId,
        status: "completed",
      });
    } catch (error) {
      log.error("source reparse failed", { durationMs: elapsedMs(startedAtMs), error });
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
    const startedAtMs = Date.now();
    const log = createLogger({
      handler: "retryInventoryIngestion",
      ingestionId: message.ingestionId,
    });
    log.info("inventory ingestion retry enqueue started");
    try {
      await this.env.INVENTORY_INGESTION_QUEUE.send(message);
      log.info("inventory ingestion retry enqueue completed", {
        durationMs: elapsedMs(startedAtMs),
      });
      this.captureWorkerEvent("worker_inventory_ingestion_retry_queued", {
        target_type: "inventory_ingestion_job",
        target_id: message.ingestionId,
        status: "queued",
      });
    } catch (error) {
      log.error("inventory ingestion retry enqueue failed", {
        durationMs: elapsedMs(startedAtMs),
        error,
      });
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
    log.info("inventory ingestion queue batch received", { messageCount: batch.messages.length });

    for (const message of batch.messages) {
      const startedAtMs = Date.now();
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
      log.info("inventory ingestion queue message received", {
        messageId: message.id,
        ingestionId,
      });
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
            messageId: message.id,
            ingestionId,
            reason: claim.reason,
            durationMs: elapsedMs(startedAtMs),
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
          messageId: message.id,
          ingestionId,
          attemptCount: claim.attemptCount,
          workflowInstanceId: claim.workflowInstanceId,
          durationMs: elapsedMs(startedAtMs),
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
        log.error("failed to start inventory ingestion workflow", {
          messageId: message.id,
          ingestionId,
          durationMs: elapsedMs(startedAtMs),
          error,
        });
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
  async scheduled(event: ScheduledEvent): Promise<void> {
    const scheduledStartedAtMs = Date.now();
    const db = createDb(this.env.DB);
    const { sources } = await import("@versioneer/db");
    const log = createLogger({ handler: "scheduled", cron: event.cron });

    const now = new Date();
    log.info("scheduled handler started", {
      scheduledTime: new Date(event.scheduledTime).toISOString(),
    });

    // --- Inventory Ingestion Queue Repair ---
    {
      const startedAtMs = Date.now();
      log.info("inventory ingestion repair started");
      try {
        const repaired = await repairInventoryIngestionQueue({
          db,
          queue: this.env.INVENTORY_INGESTION_QUEUE,
          log,
          now,
        });
        log.info("inventory ingestion repair completed", {
          repaired,
          durationMs: elapsedMs(startedAtMs),
        });
      } catch (error) {
        log.error("inventory ingestion repair failed", {
          durationMs: elapsedMs(startedAtMs),
          error,
        });
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
      const startedAtMs = Date.now();
      log.info("poll sources job started", { runId });
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
        log.info("poll sources due sources loaded", {
          runId,
          dueSourceCount: dueSources.length,
        });
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
        log.info("poll sources completed", {
          runId,
          queued,
          total: dueSources.length,
          status,
          durationMs: elapsedMs(startedAtMs),
        });
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
        log.error("poll sources job failed", {
          runId,
          durationMs: elapsedMs(startedAtMs),
          error,
        });
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
      const startedAtMs = Date.now();
      log.info("cask index sync job started", { runId });
      try {
        const due = await isCaskSyncDue(this.env);
        if (due) {
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
          log.info("cask index sync completed", {
            runId,
            status: "completed",
            durationMs: elapsedMs(startedAtMs),
          });
        } else {
          log.info("cask index sync skipped", {
            runId,
            reason: "not_due",
            durationMs: elapsedMs(startedAtMs),
          });
        }
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        log.error("cask index sync failed", {
          runId,
          durationMs: elapsedMs(startedAtMs),
          error,
        });
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
      const startedAtMs = Date.now();
      log.info("enrichment batch started", { runId });
      try {
        const batch = await runEnrichmentBatch({
          db,
          env: this.env,
          log: log.child({ job: "enrichment_batch", runId }),
        });

        log.info("enrichment batch completed", {
          runId,
          attempted: batch.attempted,
          enriched: batch.succeeded,
          failed: batch.failed,
          candidates: batch.candidateCount,
          durationMs: elapsedMs(startedAtMs),
        });
        if (batch.candidateCount > 0) {
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
        log.error("enrichment batch failed", {
          runId,
          durationMs: elapsedMs(startedAtMs),
          error,
        });
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

    log.info("scheduled handler completed", { durationMs: elapsedMs(scheduledStartedAtMs) });
  }
}
