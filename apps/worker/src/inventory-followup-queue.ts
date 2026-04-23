import { and, eq, lte, or, sql } from "drizzle-orm";

import { createLogger } from "@versioneer/core/logger";
import {
  recordJobFailure,
  resolveJobFailure,
  type InventoryFollowupQueueMessage,
} from "@versioneer/core/pipeline";
import { createDb, inventoryFollowupJobs } from "@versioneer/db";

const INVENTORY_FOLLOWUP_MAX_ATTEMPTS = 5;
const INVENTORY_FOLLOWUP_REPAIR_BATCH_SIZE = 50;
const INVENTORY_FOLLOWUP_REPAIR_STALE_MS = 5 * 60 * 1000;

type Logger = ReturnType<typeof createLogger>;
type Db = ReturnType<typeof createDb>;

export const INVENTORY_FOLLOWUP_RETRY_DELAY_SECONDS = 60;

type InventoryFollowupClaim =
  | {
      status: "claimed";
      jobId: string;
      attemptCount: number;
      workflowInstanceId: string;
      createOptions: {
        id: string;
        params: InventoryFollowupQueueMessage;
      };
    }
  | { status: "skipped"; reason: string };

export async function claimInventoryFollowupJob(params: {
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

export async function markInventoryFollowupQueueFailure(params: {
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
      enqueued += 1;
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
