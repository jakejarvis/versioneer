import { createDb } from "@versioneer/db";
import {
  handleSourceFetch,
  handleSourceParse,
  handleRecomputeLatest,
  handleCaskIndexSync,
  isCaskSyncDue,
} from "@versioneer/pipeline";
import type {
  SourceFetchJob,
  SourceParseJob,
  RecomputeLatestJob,
  CaskIndexSyncJob,
} from "@versioneer/pipeline";
import { cronJobRuns, jobFailures, generateId, idPrefixes } from "@versioneer/schema";
// Import parsers to trigger auto-registration
import "@versioneer/parsers";

interface QueueMessage<T = unknown> {
  body: T;
  ack(): void;
  retry(): void;
}

interface QueueBatch<T = unknown> {
  queue: string;
  messages: QueueMessage<T>[];
}

async function handleMessage<T>(
  message: QueueMessage<T>,
  handler: (body: T, env: Env) => Promise<void>,
  env: Env,
  jobType: string,
): Promise<void> {
  try {
    await handler(message.body as T, env as unknown as Parameters<typeof handler>[1]);
    message.ack();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[${jobType}] Error:`, errorMsg);

    // Record failure
    try {
      const db = createDb(env.DB);
      await db.insert(jobFailures).values({
        id: generateId(idPrefixes.jobFailure),
        jobType,
        jobKey: JSON.stringify(message.body),
        errorMessage: errorMsg,
        retryCount: 0,
        status: "open",
        createdAt: new Date().toISOString(),
      });
    } catch (dbError) {
      console.error("Failed to record job failure:", dbError);
    }

    message.retry();
  }
}

export default {
  async queue(batch: QueueBatch, env: Env): Promise<void> {
    const queueName = batch.queue;

    for (const message of batch.messages) {
      if (queueName.includes("source-fetch")) {
        await handleMessage(
          message as QueueMessage<SourceFetchJob>,
          handleSourceFetch,
          env,
          "source-fetch",
        );
      } else if (queueName.includes("source-parse")) {
        await handleMessage(
          message as QueueMessage<SourceParseJob>,
          handleSourceParse,
          env,
          "source-parse",
        );
      } else if (queueName.includes("recompute-latest")) {
        await handleMessage(
          message as QueueMessage<RecomputeLatestJob>,
          handleRecomputeLatest,
          env,
          "recompute-latest",
        );
      } else if (queueName.includes("cask-index-sync")) {
        await handleMessage(
          message as QueueMessage<CaskIndexSyncJob>,
          handleCaskIndexSync,
          env,
          "cask-index-sync",
        );
      } else {
        console.error("Unknown queue:", queueName);
        message.ack();
      }
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env): Promise<void> {
    const db = createDb(env.DB);
    const { sources } = await import("@versioneer/schema");
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
              await env.SOURCE_FETCH_QUEUE.send({
                sourceId: source.id,
                reason: "scheduled",
                force: false,
              });
              queued++;
            } catch (error) {
              console.error(`Failed to queue source ${source.id}:`, error);
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

    // --- Cask Index Sync ---
    {
      const runId = generateId(idPrefixes.cronJobRun);
      const startedAt = new Date().toISOString();
      try {
        if (await isCaskSyncDue(env as unknown as Parameters<typeof isCaskSyncDue>[0])) {
          await env.CASK_INDEX_SYNC_QUEUE.send({ reason: "scheduled", force: false });
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
        console.error("Failed to check/queue cask index sync:", error);
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
  },
};
