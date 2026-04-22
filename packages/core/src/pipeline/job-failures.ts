import { and, eq, sql } from "drizzle-orm";

import { createDb } from "@versioneer/db";
import { generateId, idPrefixes, jobFailures } from "@versioneer/db";

type Db = ReturnType<typeof createDb>;

export type TrackedJobFailureType =
  | "source-fetch"
  | "source-parse"
  | "recompute-latest"
  | "poll_sources"
  | "cask_index_sync"
  | "enrich_discovered_apps";

export type TrackedJobResult = {
  ok: boolean;
  errorMessage?: string;
};

function nullableStringClause(
  column: typeof jobFailures.jobKey | typeof jobFailures.relatedId,
  value: string | null,
) {
  return value === null ? sql`${column} is null` : eq(column, value);
}

export async function findOutstandingJobFailure(params: {
  db: Db;
  jobType: TrackedJobFailureType;
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

export async function recordJobFailure(params: {
  db: Db;
  jobType: TrackedJobFailureType;
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

export async function resolveJobFailure(params: {
  db: Db;
  jobType: TrackedJobFailureType;
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

export async function markJobFailureRetrying(params: { db: Db; id: string }) {
  await params.db
    .update(jobFailures)
    .set({
      status: "retrying",
      retryCount: sql`${jobFailures.retryCount} + 1`,
      resolvedAt: null,
    })
    .where(eq(jobFailures.id, params.id));
}

export async function runTrackedJob(params: {
  db: Db;
  jobType: TrackedJobFailureType;
  relatedId: string | null;
  jobKey?: string | null;
  resolveFailureOnSuccess?: boolean;
  onError?: (error: unknown) => void;
  run: () => Promise<void>;
}): Promise<TrackedJobResult> {
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
    params.onError?.(error);
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
