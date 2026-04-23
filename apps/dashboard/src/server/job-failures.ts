import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { pipelineWorker } from "@/lib/pipeline";
import { markJobFailureRetrying } from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import { jobFailures } from "@versioneer/db";

import { captureAdminEvent } from "./analytics";
import { loadEntityRefsByIds } from "./entity-summaries";
import {
  scheduleRecomputeLatest,
  scheduleSourceFetch,
  scheduleSourceReparse,
} from "./followup-jobs";
import { runCaskIndexSyncJob, runPollSourcesJob, startEnrichmentDrainJob } from "./job-runners";
import { authMiddleware } from "./middleware";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function jobFailureOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "jobType":
      return [direction(jobFailures.jobType), desc(jobFailures.createdAt)];
    case "retryCount":
      return [direction(jobFailures.retryCount), desc(jobFailures.createdAt)];
    case "status":
      return [direction(jobFailures.status), desc(jobFailures.createdAt)];
    case "createdAt":
    default:
      return [desc(jobFailures.createdAt)];
  }
}

async function retryFailure(
  db: ReturnType<typeof createDb>,
  failure: typeof jobFailures.$inferSelect,
  actorId: string | null,
): Promise<"retrying" | "resolved" | null> {
  let result: { ok: boolean } | null = null;

  switch (failure.jobType) {
    case "source-fetch":
      if (!failure.relatedId) return null;
      result = await scheduleSourceFetch({
        db,
        sourceId: failure.relatedId,
        reason: "retry",
        force: true,
        resolveFailureOnSuccess: false,
      });
      break;
    case "source-parse":
      if (!failure.relatedId) return null;
      result = await scheduleSourceReparse({
        db,
        sourceFetchId: failure.relatedId,
        resolveFailureOnSuccess: false,
      });
      break;
    case "recompute-latest":
      if (!failure.relatedId) return null;
      result = await scheduleRecomputeLatest({
        db,
        appId: failure.relatedId,
        channel: failure.jobKey ?? undefined,
        resolveFailureOnSuccess: false,
      });
      break;
    case "poll_sources": {
      const retry = await runPollSourcesJob({
        db,
        force: true,
        actorId,
        trigger: "manual",
        failureJobKey: failure.jobKey ?? "manual",
      });
      return retry.status === "completed" ? "resolved" : null;
    }
    case "cask_index_sync":
      await runCaskIndexSyncJob({
        db,
        actorId,
        trigger: "manual",
        failureJobKey: failure.jobKey ?? "manual",
      });
      return "resolved";
    case "enrich_discovered_apps":
      await startEnrichmentDrainJob({
        db,
        actorId,
        trigger: "manual",
        failureJobKey: failure.jobKey ?? "manual",
      });
      await markJobFailureRetrying({ db, id: failure.id });
      return "retrying";
    case "inventory_ingestion":
      if (!failure.relatedId) return null;
      await pipelineWorker.retryInventoryIngestion({ ingestionId: failure.relatedId });
      await markJobFailureRetrying({ db, id: failure.id });
      return "retrying";
    default:
      return null;
  }

  if (!result.ok) return null;

  await markJobFailureRetrying({ db, id: failure.id });
  return "retrying";
}

// GET /job-failures - list with pagination, default status="open"
export const listJobFailures = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["open", "retrying", "resolved", "abandoned"]).default("open"),
      jobType: z.string().optional(),
      relatedId: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, status, jobType, relatedId, sortBy, sortDir } = data;
    const db = createDb(env.DB);
    const filters = [eq(jobFailures.status, status)];
    if (jobType) filters.push(eq(jobFailures.jobType, jobType));
    if (relatedId) filters.push(eq(jobFailures.relatedId, relatedId));
    const where = and(...filters);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobFailures)
      .where(where);
    const items = await db
      .select()
      .from(jobFailures)
      .where(where)
      .orderBy(...jobFailureOrderBy(sortBy, sortDir))
      .limit(limit)
      .offset(offset);
    const relatedRefMap = await loadEntityRefsByIds(
      db,
      items.map((item) => item.relatedId),
    );

    return {
      items: items.map((item) =>
        Object.assign({}, item, {
          relatedRef: item.relatedId ? (relatedRefMap.get(item.relatedId) ?? null) : null,
        }),
      ),
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  });

// GET /job-failures/:id - detail
export const getJobFailure = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const item = await db.select().from(jobFailures).where(eq(jobFailures.id, id)).get();
    if (!item) throw new Error("Not found");
    const relatedRefMap = await loadEntityRefsByIds(db, [item.relatedId]);
    return Object.assign({}, item, {
      relatedRef: item.relatedId ? (relatedRefMap.get(item.relatedId) ?? null) : null,
    });
  });

// PATCH /job-failures/:id - update status
export const updateJobFailure = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      id: z.string().min(1),
      status: z.enum(["resolved", "abandoned", "retrying"]),
    }),
  )
  .handler(async ({ data }) => {
    const { id, status: newStatus } = data;
    const db = createDb(env.DB);

    const existing = await db.select().from(jobFailures).where(eq(jobFailures.id, id)).get();
    if (!existing) throw new Error("Not found");

    const now = new Date().toISOString();
    const updates: Record<string, unknown> = { status: newStatus };
    if (newStatus === "resolved" || newStatus === "abandoned") {
      updates.resolvedAt = now;
    }

    await db.update(jobFailures).set(updates).where(eq(jobFailures.id, id));

    return { status: "updated" };
  });

// POST /job-failures/:id/retry - re-enqueue based on jobType
export const retryJobFailure = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id }, context }) => {
    const db = createDb(env.DB);
    const failure = await db.select().from(jobFailures).where(eq(jobFailures.id, id)).get();
    if (!failure) throw new Error("Not found");

    const status = await retryFailure(db, failure, context.user.email);
    await captureAdminEvent(context.user, "job_failure_retry_triggered", {
      target_type: "job_failure",
      target_id: id,
      job_type: failure.jobType,
      related_id: failure.relatedId,
      status: status ?? failure.status,
      count: status ? 1 : 0,
    });
    return { status: status ?? failure.status, count: status ? 1 : 0 };
  });

// POST /job-failures/retry-all - re-enqueue all open failures
export const retryAllJobFailures = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      jobType: z.string().optional(),
    }),
  )
  .handler(async ({ data, context }) => {
    const { jobType } = data;
    const db = createDb(env.DB);

    const failures = await db
      .select()
      .from(jobFailures)
      .where(eq(jobFailures.status, "open"))
      .all();

    const matching = jobType ? failures.filter((f) => f.jobType === jobType) : failures;
    let retried = 0;
    let failed = 0;

    for (const failure of matching) {
      try {
        if (await retryFailure(db, failure, context.user.email)) {
          retried++;
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    await captureAdminEvent(context.user, "job_failure_retry_all_triggered", {
      target_type: "job_failure",
      job_type: jobType ?? "all",
      status: failed > 0 ? "partial" : "retrying",
      count: retried,
      failed_count: failed,
    });

    return {
      status: failed > 0 ? "partial" : "retrying",
      count: retried,
      failedCount: failed,
    };
  });
