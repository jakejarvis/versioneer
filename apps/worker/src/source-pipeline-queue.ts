import { eq } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";

import { createLogger } from "@versioneer/core/logger";
import { computeNextPollAt } from "@versioneer/core/pipeline";
import { createDb, sources } from "@versioneer/db";

const SOURCE_PIPELINE_BATCH_SIZE = 100;

type Logger = ReturnType<typeof createLogger>;
type Db = ReturnType<typeof createDb>;

export async function createSourcePipelineBatch<TJob extends { params?: { sourceId?: string } }>(
  sourcePipeline: {
    createBatch: (jobs: TJob[]) => Promise<unknown[]>;
    create: (job: TJob) => Promise<unknown>;
  },
  jobs: TJob[],
  log: Logger,
): Promise<number> {
  let queued = 0;

  for (let index = 0; index < jobs.length; index += SOURCE_PIPELINE_BATCH_SIZE) {
    const chunk = jobs.slice(index, index + SOURCE_PIPELINE_BATCH_SIZE);
    const batchIndex = index / SOURCE_PIPELINE_BATCH_SIZE + 1;
    log.info("source pipeline batch queue started", {
      batchIndex,
      batchSize: chunk.length,
      totalJobs: jobs.length,
    });
    try {
      const instances = await sourcePipeline.createBatch(chunk);
      queued += instances.length;
      log.info("source pipeline batch queued", {
        batchIndex,
        batchSize: chunk.length,
        queued: instances.length,
        queuedTotal: queued,
        totalJobs: jobs.length,
      });
    } catch (error) {
      log.error("failed to queue source pipeline batch", {
        batchIndex,
        batchSize: chunk.length,
        queuedTotal: queued,
        totalJobs: jobs.length,
        error,
      });
      log.info("source pipeline batch fallback started", {
        batchIndex,
        batchSize: chunk.length,
      });
      let fallbackQueued = 0;
      for (const job of chunk) {
        try {
          await sourcePipeline.create(job);
          queued += 1;
          fallbackQueued += 1;
        } catch (sourceError) {
          log.error("failed to queue source pipeline", {
            sourceId: job.params?.sourceId,
            error: sourceError,
          });
        }
      }
      log.info("source pipeline batch fallback completed", {
        batchIndex,
        batchSize: chunk.length,
        fallbackQueued,
        queuedTotal: queued,
        totalJobs: jobs.length,
      });
    }
  }

  return queued;
}

export async function updateNextPollAtForQueuedSources(params: {
  db: Db;
  dueSources: Array<{ id: string; pollIntervalMinutes: number }>;
  nowIso: string;
}): Promise<void> {
  const writes: BatchItem<"sqlite">[] = params.dueSources.map((source) =>
    params.db
      .update(sources)
      .set({
        nextPollAt: computeNextPollAt({
          baseTime: params.nowIso,
          pollIntervalMinutes: source.pollIntervalMinutes,
          now: params.nowIso,
        }),
      })
      .where(eq(sources.id, source.id)),
  );

  if (writes.length === 0) return;
  const firstWrite = writes[0];
  if (!firstWrite) return;
  await params.db.batch([firstWrite, ...writes.slice(1)]);
}
