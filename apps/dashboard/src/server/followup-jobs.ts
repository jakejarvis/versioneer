import { eq } from "drizzle-orm";

import { pipelineWorker, sourcePipeline } from "@/lib/pipeline";
import { createLogger } from "@versioneer/core/logger";
import { computeNextPollAt, runTrackedJob, type TrackedJobResult } from "@versioneer/core/pipeline";
import { createDb, sources } from "@versioneer/db";

type Db = ReturnType<typeof createDb>;

type FollowupJobType = "source-fetch" | "source-parse" | "recompute-latest";

type FollowupResult = TrackedJobResult;

const log = createLogger({ component: "dashboard", module: "followup-jobs" });

export async function scheduleSourceFetch(params: {
  db: Db;
  sourceId: string;
  reason: string;
  force: boolean;
  resolveFailureOnSuccess?: boolean;
}): Promise<FollowupResult> {
  return runTrackedJob({
    db: params.db,
    jobType: "source-fetch",
    relatedId: params.sourceId,
    resolveFailureOnSuccess: params.resolveFailureOnSuccess,
    onError: (error) =>
      log.error("follow-up job failed", {
        jobType: "source-fetch" satisfies FollowupJobType,
        relatedId: params.sourceId,
        error,
      }),
    run: async () => {
      const source = await params.db
        .select({ pollIntervalMinutes: sources.pollIntervalMinutes })
        .from(sources)
        .where(eq(sources.id, params.sourceId))
        .get();
      await sourcePipeline.create({
        params: { sourceId: params.sourceId, reason: params.reason, force: params.force },
      });
      if (source) {
        const now = new Date().toISOString();
        await params.db
          .update(sources)
          .set({
            nextPollAt: computeNextPollAt({
              baseTime: now,
              pollIntervalMinutes: source.pollIntervalMinutes,
              now,
            }),
          })
          .where(eq(sources.id, params.sourceId));
      }
    },
  });
}

export async function scheduleSourceReparse(params: {
  db: Db;
  sourceFetchId: string;
  resolveFailureOnSuccess?: boolean;
}): Promise<FollowupResult> {
  return runTrackedJob({
    db: params.db,
    jobType: "source-parse",
    relatedId: params.sourceFetchId,
    resolveFailureOnSuccess: params.resolveFailureOnSuccess,
    onError: (error) =>
      log.error("follow-up job failed", {
        jobType: "source-parse" satisfies FollowupJobType,
        relatedId: params.sourceFetchId,
        error,
      }),
    run: async () => {
      await pipelineWorker.reparse({ sourceFetchId: params.sourceFetchId });
    },
  });
}

export async function scheduleRecomputeLatest(params: {
  db: Db;
  appId: string;
  channel?: string | null;
  resolveFailureOnSuccess?: boolean;
}): Promise<FollowupResult> {
  return runTrackedJob({
    db: params.db,
    jobType: "recompute-latest",
    relatedId: params.appId,
    jobKey: params.channel ?? null,
    resolveFailureOnSuccess: params.resolveFailureOnSuccess,
    onError: (error) =>
      log.error("follow-up job failed", {
        jobType: "recompute-latest" satisfies FollowupJobType,
        relatedId: params.appId,
        jobKey: params.channel ?? null,
        error,
      }),
    run: async () => {
      await pipelineWorker.recomputeLatest({
        appId: params.appId,
        channel: params.channel ?? undefined,
      });
    },
  });
}
