import { createDb } from "@versioneer/db";
import {
  handleSourceFetch,
  handleSourceParse,
  handleRecomputeLatest,
  handleCaskIndexSync,
  isCaskSyncDue,
} from "@versioneer/pipeline";
import { cronJobRuns, jobFailures, generateId, idPrefixes } from "@versioneer/schema";
// Import parsers to trigger auto-registration
import "@versioneer/parsers";

async function handleMessage<T>(
  message: Message<T>,
  handler: (body: T, env: Env) => Promise<void>,
  env: Env,
  jobType: string,
): Promise<void> {
  try {
    await handler(message.body as T, env as unknown as Parameters<typeof handler>[1]);
    message.ack();
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error(`[${jobType}] Error (attempt ${message.attempts}):`, errorMsg);
    message.retry();
  }
}

/**
 * Extracts the logical queue type from a full queue name like
 * "versioneer-source-fetch-production" → "source-fetch".
 */
function queueType(queueName: string): string {
  return queueName.replace(/^versioneer-/, "").replace(/-(dev|production)$/, "");
}

export default {
  async queue(batch: MessageBatch, env: Env): Promise<void> {
    const type = queueType(batch.queue);

    // DLQ consumer — record dead-lettered messages for dashboard visibility
    if (type === "dlq") {
      const db = createDb(env.DB);
      for (const message of batch.messages) {
        try {
          const body = message.body as Record<string, unknown>;
          await db.insert(jobFailures).values({
            id: generateId(idPrefixes.jobFailure),
            jobType: "dead-lettered",
            jobKey: JSON.stringify(body),
            errorMessage: "Message exhausted all retries and was dead-lettered",
            retryCount: message.attempts,
            status: "abandoned",
            createdAt: new Date().toISOString(),
          });
        } catch (dbError) {
          console.error("Failed to record DLQ message:", dbError);
        }
        message.ack();
      }
      return;
    }

    // Route messages to handlers based on queue type
    let handler: ((body: unknown, env: Env) => Promise<void>) | undefined;
    switch (type) {
      case "source-fetch":
        handler = handleSourceFetch as (body: unknown, env: Env) => Promise<void>;
        break;
      case "source-parse":
        handler = handleSourceParse as (body: unknown, env: Env) => Promise<void>;
        break;
      case "recompute-latest":
        handler = handleRecomputeLatest as (body: unknown, env: Env) => Promise<void>;
        break;
    }

    if (!handler) {
      console.error("Unknown queue:", batch.queue);
      for (const message of batch.messages) {
        message.ack();
      }
      return;
    }

    // Process messages in parallel within the batch
    await Promise.allSettled(batch.messages.map((msg) => handleMessage(msg, handler, env, type)));
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

    // --- Cask Index Sync (runs directly, no queue hop) ---
    {
      const runId = generateId(idPrefixes.cronJobRun);
      const startedAt = new Date().toISOString();
      try {
        if (await isCaskSyncDue(env as unknown as Parameters<typeof isCaskSyncDue>[0])) {
          await handleCaskIndexSync(
            { reason: "scheduled", force: false },
            env as unknown as Parameters<typeof handleCaskIndexSync>[1],
          );
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
  },
};
