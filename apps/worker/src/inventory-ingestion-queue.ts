import { and, eq, lte, or, sql } from "drizzle-orm";

import { createLogger } from "@versioneer/core/logger";
import {
  recordJobFailure,
  resolveJobFailure,
  type InventoryIngestionQueueMessage,
} from "@versioneer/core/pipeline";
import { createDb, inventoryIngestionJobs } from "@versioneer/db";

const INVENTORY_INGESTION_MAX_ATTEMPTS = 5;
const INVENTORY_INGESTION_REPAIR_BATCH_SIZE = 50;
const INVENTORY_INGESTION_REPAIR_QUEUE_STALE_MS = 5 * 60 * 1000;
const INVENTORY_INGESTION_REPAIR_RUNNING_STALE_MS = 60 * 60 * 1000;

type Logger = ReturnType<typeof createLogger>;
type Db = ReturnType<typeof createDb>;

export const INVENTORY_INGESTION_RETRY_DELAY_SECONDS = 60;

type InventoryIngestionClaim =
  | {
      status: "claimed";
      ingestionId: string;
      attemptCount: number;
      workflowInstanceId: string;
      createOptions: {
        id: string;
        params: InventoryIngestionQueueMessage;
      };
    }
  | { status: "skipped"; reason: string };

export async function claimInventoryIngestionJob(params: {
  db: Db;
  ingestionId: string;
  now: string;
}): Promise<InventoryIngestionClaim> {
  const job = await params.db
    .select({
      id: inventoryIngestionJobs.id,
      status: inventoryIngestionJobs.status,
      attemptCount: inventoryIngestionJobs.attemptCount,
    })
    .from(inventoryIngestionJobs)
    .where(eq(inventoryIngestionJobs.id, params.ingestionId))
    .get();

  if (!job) return { status: "skipped", reason: "missing-job" };
  if (job.status === "completed" || job.status === "running" || job.status === "queued") {
    return { status: "skipped", reason: job.status };
  }
  if (job.status === "failed" && job.attemptCount >= INVENTORY_INGESTION_MAX_ATTEMPTS) {
    return { status: "skipped", reason: "attempts-exhausted" };
  }

  const attemptCount = job.attemptCount + 1;
  const workflowInstanceId = `${params.ingestionId}-${attemptCount}`;
  const claimed = await params.db
    .update(inventoryIngestionJobs)
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
        eq(inventoryIngestionJobs.id, params.ingestionId),
        or(
          eq(inventoryIngestionJobs.status, "pending"),
          eq(inventoryIngestionJobs.status, "failed"),
        ),
      ),
    )
    .returning({
      ingestionId: inventoryIngestionJobs.id,
      attemptCount: inventoryIngestionJobs.attemptCount,
      workflowInstanceId: inventoryIngestionJobs.workflowInstanceId,
    });

  const row = claimed[0];
  if (!row?.workflowInstanceId) return { status: "skipped", reason: "already-claimed" };

  return {
    status: "claimed",
    ingestionId: row.ingestionId,
    attemptCount: row.attemptCount,
    workflowInstanceId: row.workflowInstanceId,
    createOptions: {
      id: row.workflowInstanceId,
      params: { ingestionId: row.ingestionId },
    },
  };
}

export async function markInventoryIngestionQueueFailure(params: {
  db: Db;
  ingestionId: string;
  errorMessage: string;
  now: string;
}) {
  await params.db
    .update(inventoryIngestionJobs)
    .set({
      status: "failed",
      errorMessage: params.errorMessage,
      updatedAt: params.now,
      completedAt: params.now,
    })
    .where(eq(inventoryIngestionJobs.id, params.ingestionId));

  await recordJobFailure({
    db: params.db,
    jobType: "inventory_ingestion",
    relatedId: params.ingestionId,
    jobKey: "queue",
    errorMessage: params.errorMessage,
  });
}

export async function repairInventoryIngestionQueue(params: {
  db: Db;
  queue: Queue<InventoryIngestionQueueMessage>;
  log: Logger;
  now: Date;
}): Promise<number> {
  const queueStaleBefore = new Date(
    params.now.getTime() - INVENTORY_INGESTION_REPAIR_QUEUE_STALE_MS,
  );
  const runningStaleBefore = new Date(
    params.now.getTime() - INVENTORY_INGESTION_REPAIR_RUNNING_STALE_MS,
  );
  const nowIso = params.now.toISOString();
  const queueStaleBeforeIso = queueStaleBefore.toISOString();
  const runningStaleBeforeIso = runningStaleBefore.toISOString();
  const jobs = await params.db
    .select({
      id: inventoryIngestionJobs.id,
      status: inventoryIngestionJobs.status,
      updatedAt: inventoryIngestionJobs.updatedAt,
    })
    .from(inventoryIngestionJobs)
    .where(
      or(
        and(
          eq(inventoryIngestionJobs.status, "pending"),
          lte(inventoryIngestionJobs.updatedAt, queueStaleBeforeIso),
        ),
        and(
          eq(inventoryIngestionJobs.status, "failed"),
          lte(inventoryIngestionJobs.updatedAt, queueStaleBeforeIso),
          sql`${inventoryIngestionJobs.attemptCount} < ${INVENTORY_INGESTION_MAX_ATTEMPTS}`,
        ),
        and(
          eq(inventoryIngestionJobs.status, "queued"),
          lte(inventoryIngestionJobs.updatedAt, queueStaleBeforeIso),
          sql`${inventoryIngestionJobs.attemptCount} < ${INVENTORY_INGESTION_MAX_ATTEMPTS}`,
        ),
        and(
          eq(inventoryIngestionJobs.status, "running"),
          lte(inventoryIngestionJobs.updatedAt, runningStaleBeforeIso),
          sql`${inventoryIngestionJobs.attemptCount} < ${INVENTORY_INGESTION_MAX_ATTEMPTS}`,
        ),
      ),
    )
    .limit(INVENTORY_INGESTION_REPAIR_BATCH_SIZE)
    .all();

  let enqueued = 0;
  for (const job of jobs) {
    try {
      if (job.status === "queued" || job.status === "running") {
        const reclaimed = await params.db
          .update(inventoryIngestionJobs)
          .set({
            status: "pending",
            workflowInstanceId: null,
          })
          .where(
            and(
              eq(inventoryIngestionJobs.id, job.id),
              eq(inventoryIngestionJobs.status, job.status),
              eq(inventoryIngestionJobs.updatedAt, job.updatedAt),
            ),
          )
          .returning({ id: inventoryIngestionJobs.id });
        if (!reclaimed[0]) {
          continue;
        }
      }

      await params.queue.send({ ingestionId: job.id });
      await params.db
        .update(inventoryIngestionJobs)
        .set({ updatedAt: nowIso })
        .where(eq(inventoryIngestionJobs.id, job.id));
      await resolveJobFailure({
        db: params.db,
        jobType: "inventory_ingestion",
        relatedId: job.id,
        jobKey: "repair",
      });
      enqueued += 1;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      params.log.error("failed to repair inventory ingestion queue", {
        ingestionId: job.id,
        status: job.status,
        error,
      });
      await recordJobFailure({
        db: params.db,
        jobType: "inventory_ingestion",
        relatedId: job.id,
        jobKey: "repair",
        errorMessage,
      });
    }
  }

  return enqueued;
}
