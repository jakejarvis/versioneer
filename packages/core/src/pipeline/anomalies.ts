import { and, eq, sql } from "drizzle-orm";

import { createDb, generateId, idPrefixes, jobFailures } from "@versioneer/db";

type Db = ReturnType<typeof createDb>;

export const sourceAnomalyKinds = [
  "blocked_fetch_url",
  "new_fetch_hostname",
  "new_artifact_hostname",
  "missing_install_hash",
  "parser_error_spike",
] as const;

export type SourceAnomalyKind = (typeof sourceAnomalyKinds)[number];

export async function recordSourceAnomaly(params: {
  db: Db;
  sourceId: string;
  kind: SourceAnomalyKind;
  fingerprint: string;
  message: string;
  now?: string;
}) {
  const now = params.now ?? new Date().toISOString();
  const jobKey = `${params.kind}:${params.fingerprint}`;
  const id = generateId(idPrefixes.jobFailure);
  const dedupeKey = JSON.stringify(["source-anomaly", params.sourceId, jobKey]);
  let existing = await params.db
    .select({ id: jobFailures.id })
    .from(jobFailures)
    .where(
      and(eq(jobFailures.dedupeKey, dedupeKey), sql`${jobFailures.status} in ('open', 'retrying')`),
    )
    .get();
  existing ??= await params.db
    .select({ id: jobFailures.id })
    .from(jobFailures)
    .where(
      and(
        sql`${jobFailures.dedupeKey} is null`,
        eq(jobFailures.jobType, "source-anomaly"),
        eq(jobFailures.relatedId, params.sourceId),
        eq(jobFailures.jobKey, jobKey),
        sql`${jobFailures.status} in ('open', 'retrying')`,
      ),
    )
    .get();

  if (existing) {
    await params.db
      .update(jobFailures)
      .set({
        dedupeKey,
        status: "open",
        errorMessage: params.message,
        retryCount: 0,
        resolvedAt: null,
      })
      .where(eq(jobFailures.id, existing.id));
    return existing.id;
  }

  await params.db
    .insert(jobFailures)
    .values({
      id,
      jobType: "source-anomaly",
      jobKey,
      relatedId: params.sourceId,
      dedupeKey,
      errorMessage: params.message,
      retryCount: 0,
      status: "open",
      createdAt: now,
      resolvedAt: null,
    })
    .onConflictDoUpdate({
      target: jobFailures.dedupeKey,
      targetWhere: sql`${jobFailures.dedupeKey} is not null and ${jobFailures.status} in ('open', 'retrying')`,
      set: {
        status: "open",
        errorMessage: params.message,
        retryCount: 0,
        resolvedAt: null,
      },
    });

  const inserted = await params.db
    .select({ id: jobFailures.id })
    .from(jobFailures)
    .where(
      and(eq(jobFailures.dedupeKey, dedupeKey), sql`${jobFailures.status} in ('open', 'retrying')`),
    )
    .get();
  return inserted?.id ?? id;
}
