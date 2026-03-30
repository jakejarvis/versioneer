import { createDb } from "@versioneer/db";
import { generateId, idPrefixes, jobFailures } from "@versioneer/db";
import { and, eq, sql } from "drizzle-orm";

import { pipelineWorker, sourcePipeline } from "@/lib/pipeline";

type Db = ReturnType<typeof createDb>;

type FollowupJobType = "source-fetch" | "source-parse" | "recompute-latest";

type FollowupResult = {
  ok: boolean;
  errorMessage?: string;
};

function nullableStringClause(
  column: typeof jobFailures.jobKey | typeof jobFailures.relatedId,
  value: string | null,
) {
  return value === null ? sql`${column} is null` : eq(column, value);
}

async function findOutstandingJobFailure(params: {
  db: Db;
  jobType: FollowupJobType;
  relatedId: string | null;
  jobKey: string | null;
}) {
  return params.db
    .select({ id: jobFailures.id })
    .from(jobFailures)
    .where(
      and(
        eq(jobFailures.jobType, params.jobType),
        nullableStringClause(jobFailures.relatedId, params.relatedId),
        nullableStringClause(jobFailures.jobKey, params.jobKey),
        sql`${jobFailures.status} in ('open', 'retrying')`,
      ),
    )
    .get();
}

async function recordJobFailure(params: {
  db: Db;
  jobType: FollowupJobType;
  relatedId: string | null;
  jobKey: string | null;
  errorMessage: string;
}) {
  const existing = await findOutstandingJobFailure(params);
  if (existing) {
    await params.db
      .update(jobFailures)
      .set({
        status: "open",
        errorMessage: params.errorMessage,
        retryCount: sql`${jobFailures.retryCount} + 1`,
        resolvedAt: null,
      })
      .where(eq(jobFailures.id, existing.id));
    return existing.id;
  }

  const now = new Date().toISOString();
  const id = generateId(idPrefixes.jobFailure);
  await params.db.insert(jobFailures).values({
    id,
    jobType: params.jobType,
    jobKey: params.jobKey,
    relatedId: params.relatedId,
    errorMessage: params.errorMessage,
    retryCount: 0,
    status: "open",
    createdAt: now,
    resolvedAt: null,
  });
  return id;
}

async function resolveJobFailure(params: {
  db: Db;
  jobType: FollowupJobType;
  relatedId: string | null;
  jobKey: string | null;
}) {
  await params.db
    .update(jobFailures)
    .set({
      status: "resolved",
      resolvedAt: new Date().toISOString(),
    })
    .where(
      and(
        eq(jobFailures.jobType, params.jobType),
        nullableStringClause(jobFailures.relatedId, params.relatedId),
        nullableStringClause(jobFailures.jobKey, params.jobKey),
        sql`${jobFailures.status} in ('open', 'retrying')`,
      ),
    );
}

async function runFollowupJob(params: {
  db: Db;
  jobType: FollowupJobType;
  relatedId: string | null;
  jobKey?: string | null;
  resolveFailureOnSuccess?: boolean;
  run: () => Promise<void>;
}): Promise<FollowupResult> {
  const jobKey = params.jobKey ?? null;

  try {
    await params.run();
    if (params.resolveFailureOnSuccess !== false) {
      await resolveJobFailure({
        db: params.db,
        jobType: params.jobType,
        relatedId: params.relatedId,
        jobKey,
      });
    }
    return { ok: true };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      `Follow-up job failed (${params.jobType}, relatedId=${params.relatedId ?? "none"}, jobKey=${jobKey ?? "none"}):`,
      error,
    );
    await recordJobFailure({
      db: params.db,
      jobType: params.jobType,
      relatedId: params.relatedId,
      jobKey,
      errorMessage,
    });
    return { ok: false, errorMessage };
  }
}

export async function scheduleSourceFetch(params: {
  db: Db;
  sourceId: string;
  reason: string;
  force: boolean;
  resolveFailureOnSuccess?: boolean;
}): Promise<FollowupResult> {
  return runFollowupJob({
    db: params.db,
    jobType: "source-fetch",
    relatedId: params.sourceId,
    resolveFailureOnSuccess: params.resolveFailureOnSuccess,
    run: async () => {
      await sourcePipeline.create({
        params: { sourceId: params.sourceId, reason: params.reason, force: params.force },
      });
    },
  });
}

export async function scheduleSourceReparse(params: {
  db: Db;
  sourceFetchId: string;
  resolveFailureOnSuccess?: boolean;
}): Promise<FollowupResult> {
  return runFollowupJob({
    db: params.db,
    jobType: "source-parse",
    relatedId: params.sourceFetchId,
    resolveFailureOnSuccess: params.resolveFailureOnSuccess,
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
  return runFollowupJob({
    db: params.db,
    jobType: "recompute-latest",
    relatedId: params.appId,
    jobKey: params.channel ?? null,
    resolveFailureOnSuccess: params.resolveFailureOnSuccess,
    run: async () => {
      await pipelineWorker.recomputeLatest({
        appId: params.appId,
        channel: params.channel ?? undefined,
      });
    },
  });
}
