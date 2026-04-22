import { WorkerEntrypoint } from "cloudflare:workers";
import { and, eq, isNull, lte, or, sql } from "drizzle-orm";

import { createLogger } from "@versioneer/core/logger";
import {
  handleSourceParse,
  handleRecomputeLatest,
  handleCaskIndexSync,
  isCaskSyncDue,
  recordJobFailure,
  resolveJobFailure,
  computeNextPollAt,
  inventoryFollowupQueueMessageSchema,
} from "@versioneer/core/pipeline";
import type {
  InventoryFollowupQueueMessage,
  SourceParseJob,
  RecomputeLatestJob,
} from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import { cronJobRuns, generateId, idPrefixes, inventoryFollowupJobs } from "@versioneer/db";
// Import parsers to trigger auto-registration
import "@versioneer/core/parsers";
import { runEnrichmentBatch } from "./enrichment";

// Re-export the Workflow class so wrangler can discover it
export { EnrichmentDrainWorkflow } from "./workflows/enrichment-drain";
export { InventoryFollowupWorkflow } from "./workflows/inventory-followup";
export { SourcePipelineWorkflow } from "./workflows/source-pipeline";

const SOURCE_PIPELINE_BATCH_SIZE = 100;
const INVENTORY_FOLLOWUP_MAX_ATTEMPTS = 5;
const INVENTORY_FOLLOWUP_RETRY_DELAY_SECONDS = 60;
const INVENTORY_FOLLOWUP_REPAIR_BATCH_SIZE = 50;
const INVENTORY_FOLLOWUP_REPAIR_STALE_MS = 5 * 60 * 1000;

type SourcePipelineBinding = Env["SOURCE_PIPELINE"];
type SourcePipelineCreateOptions = NonNullable<Parameters<SourcePipelineBinding["create"]>[0]>;
type InventoryFollowupWorkflowBinding = Env["INVENTORY_FOLLOWUP"];
type InventoryFollowupWorkflowCreateOptions = NonNullable<
  Parameters<InventoryFollowupWorkflowBinding["create"]>[0]
>;
type Logger = ReturnType<typeof createLogger>;

type Db = ReturnType<typeof createDb>;

type InventoryFollowupClaim =
  | {
      status: "claimed";
      jobId: string;
      attemptCount: number;
      workflowInstanceId: string;
      createOptions: InventoryFollowupWorkflowCreateOptions;
    }
  | { status: "skipped"; reason: string };

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

async function claimInventoryFollowupJob(params: {
  db: Db;
  jobId: string;
  now: string;
}): Promise<InventoryFollowupClaim> {
  const job = await params.db
    .select({
      id: inventoryFollowupJobs.id,
      status: inventoryFollowupJobs.status,
      attemptCount: inventoryFollowupJobs.attemptCount,
    })
    .from(inventoryFollowupJobs)
    .where(eq(inventoryFollowupJobs.id, params.jobId))
    .get();

  if (!job) return { status: "skipped", reason: "missing-job" };
  if (job.status === "completed" || job.status === "running" || job.status === "queued") {
    return { status: "skipped", reason: job.status };
  }
  if (job.status === "failed" && job.attemptCount >= INVENTORY_FOLLOWUP_MAX_ATTEMPTS) {
    return { status: "skipped", reason: "attempts-exhausted" };
  }

  const attemptCount = job.attemptCount + 1;
  const workflowInstanceId = `${params.jobId}-${attemptCount}`;
  const claimed = await params.db
    .update(inventoryFollowupJobs)
    .set({
      status: "queued",
      attemptCount,
      workflowInstanceId,
      queuedAt: params.now,
      startedAt: null,
      completedAt: null,
      errorMessage: null,
      updatedAt: params.now,
    })
    .where(
      and(
        eq(inventoryFollowupJobs.id, params.jobId),
        or(eq(inventoryFollowupJobs.status, "pending"), eq(inventoryFollowupJobs.status, "failed")),
      ),
    )
    .returning({
      jobId: inventoryFollowupJobs.id,
      attemptCount: inventoryFollowupJobs.attemptCount,
      workflowInstanceId: inventoryFollowupJobs.workflowInstanceId,
    });

  const row = claimed[0];
  if (!row?.workflowInstanceId) return { status: "skipped", reason: "already-claimed" };

  return {
    status: "claimed",
    jobId: row.jobId,
    attemptCount: row.attemptCount,
    workflowInstanceId: row.workflowInstanceId,
    createOptions: {
      id: row.workflowInstanceId,
      params: { jobId: row.jobId },
    },
  };
}

async function markInventoryFollowupQueueFailure(params: {
  db: Db;
  jobId: string;
  errorMessage: string;
  now: string;
}) {
  await params.db
    .update(inventoryFollowupJobs)
    .set({
      status: "failed",
      errorMessage: params.errorMessage,
      updatedAt: params.now,
      completedAt: params.now,
    })
    .where(eq(inventoryFollowupJobs.id, params.jobId));
  await recordJobFailure({
    db: params.db,
    jobType: "inventory_followup",
    relatedId: params.jobId,
    jobKey: "queue",
    errorMessage: params.errorMessage,
  });
}

export async function repairInventoryFollowupQueue(params: {
  db: Db;
  queue: Queue<InventoryFollowupQueueMessage>;
  log: Logger;
  now: Date;
}): Promise<number> {
  const staleBefore = new Date(params.now.getTime() - INVENTORY_FOLLOWUP_REPAIR_STALE_MS);
  const nowIso = params.now.toISOString();
  const staleBeforeIso = staleBefore.toISOString();
  const jobs = await params.db
    .select({ id: inventoryFollowupJobs.id, status: inventoryFollowupJobs.status })
    .from(inventoryFollowupJobs)
    .where(
      or(
        and(
          eq(inventoryFollowupJobs.status, "pending"),
          lte(inventoryFollowupJobs.updatedAt, staleBeforeIso),
        ),
        and(
          eq(inventoryFollowupJobs.status, "failed"),
          lte(inventoryFollowupJobs.updatedAt, staleBeforeIso),
          sql`${inventoryFollowupJobs.attemptCount} < ${INVENTORY_FOLLOWUP_MAX_ATTEMPTS}`,
        ),
      ),
    )
    .limit(INVENTORY_FOLLOWUP_REPAIR_BATCH_SIZE)
    .all();

  let enqueued = 0;
  for (const job of jobs) {
    try {
      await params.queue.send({ jobId: job.id });
      await params.db
        .update(inventoryFollowupJobs)
        .set({ updatedAt: nowIso })
        .where(eq(inventoryFollowupJobs.id, job.id));
      await resolveJobFailure({
        db: params.db,
        jobType: "inventory_followup",
        relatedId: job.id,
        jobKey: "repair",
      });
      enqueued++;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      params.log.error("failed to repair inventory follow-up queue", {
        jobId: job.id,
        status: job.status,
        error,
      });
      await recordJobFailure({
        db: params.db,
        jobType: "inventory_followup",
        relatedId: job.id,
        jobKey: "repair",
        errorMessage,
      });
    }
  }

  return enqueued;
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
   * RPC: re-enqueue a durable inventory follow-up job.
   * Called via service binding from the dashboard failure queue.
   */
  async retryInventoryFollowup(params: InventoryFollowupQueueMessage): Promise<void> {
    const message = inventoryFollowupQueueMessageSchema.parse(params);
    await this.env.INVENTORY_FOLLOWUP_QUEUE.send(message);
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
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const writes: any[] = dueSources.map((source) =>
            db
              .update(sources)
              .set({
                nextPollAt: computeNextPollAt({
                  baseTime: nowIso,
                  pollIntervalMinutes: source.pollIntervalMinutes,
                  now: nowIso,
                }),
              })
              .where(eq(sources.id, source.id)),
          );
          await db.batch(writes as [(typeof writes)[0], ...typeof writes]);
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
