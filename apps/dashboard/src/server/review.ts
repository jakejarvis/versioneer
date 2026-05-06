import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, desc, eq, or, sql } from "drizzle-orm";
import { z } from "zod";

import { createLogger } from "@versioneer/core/logger";
import { createDb } from "@versioneer/db";
import {
  auditLog,
  catalogSuggestions,
  generateId,
  idPrefixes,
  suggestionEvidence,
} from "@versioneer/db";
import { queueTypeSchema, suggestionStatusSchema } from "@versioneer/schemas/review";

import { captureAdminEvent } from "./analytics";
import { invalidateInventoryMatchSnapshot } from "./cache";
import { loadAppsByIds, loadSourcesByIds, toAppSummary, toSourceSummary } from "./entity-summaries";
import { authMiddleware } from "./middleware";
import { catalogSuggestionOrderBy } from "./order-by";
import { scheduleRecomputeLatest, scheduleSourceFetch } from "./pipeline-jobs";
import {
  applySuggestionApproval,
  type ReviewApprovalResult,
  type ReviewPostCommitJob,
} from "./review-approval";
import { catalogSuggestionApprovalClaimableCondition } from "./review-attention";

const suggestionQueueTypeSchema = queueTypeSchema;
const log = createLogger({ component: "dashboard", module: "review" });

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

const listSuggestionsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
  status: suggestionStatusSchema.default("pending"),
  queueType: suggestionQueueTypeSchema.optional(),
  sortBy: z.string().optional(),
  sortDir: sortDirectionSchema,
});

type Db = ReturnType<typeof createDb>;
type SuggestionRow = typeof catalogSuggestions.$inferSelect;
type ReviewAdminActor = { id: string };
type ReviewAnalyticsCapture = (
  actor: ReviewAdminActor,
  event: string,
  properties: Record<string, unknown>,
) => Promise<void>;

type ReviewApprovalDependencies = {
  captureAdminEvent: ReviewAnalyticsCapture;
  invalidateInventoryMatchSnapshot: (env: Pick<Env, "CACHE_KV">) => Promise<void>;
  scheduleSourceFetch: typeof scheduleSourceFetch;
  scheduleRecomputeLatest: typeof scheduleRecomputeLatest;
};

export interface ReviewPostCommitJobFailure {
  job: ReviewPostCommitJob;
  errorMessage: string;
}

function buildSuggestionAuditPayload(
  suggestion: SuggestionRow,
  extra: Record<string, unknown> = {},
) {
  return JSON.stringify({
    queueType: suggestion.queueType,
    appId: suggestion.appId,
    sourceId: suggestion.sourceId,
    ...extra,
  });
}

async function getSuggestionOrThrow(db: Db, id: string) {
  const suggestion = await db
    .select()
    .from(catalogSuggestions)
    .where(eq(catalogSuggestions.id, id))
    .get();
  if (!suggestion) throw new Error("Not found");
  return suggestion;
}

async function claimCatalogSuggestionApproval(params: {
  db: Db;
  id: string;
  reviewer: string;
  now: string;
}) {
  const claimed = await params.db
    .update(catalogSuggestions)
    .set({
      status: "processing",
      processingStartedAt: params.now,
      processingBy: params.reviewer,
      lastError: null,
      reviewedAt: null,
      reviewedBy: null,
      approvalAttemptCount: sql`${catalogSuggestions.approvalAttemptCount} + 1`,
      updatedAt: params.now,
    })
    .where(
      and(
        eq(catalogSuggestions.id, params.id),
        catalogSuggestionApprovalClaimableCondition(params.now),
      ),
    )
    .returning();

  const suggestion = claimed[0];
  if (suggestion) {
    return { status: "claimed" as const, suggestion };
  }

  return {
    status: "skipped" as const,
    suggestion: await getSuggestionOrThrow(params.db, params.id),
  };
}

async function rejectCatalogSuggestionIfClaimable(params: {
  db: Db;
  id: string;
  reviewer: string;
  now: string;
}) {
  const rejected = await params.db
    .update(catalogSuggestions)
    .set({
      status: "rejected",
      processingStartedAt: null,
      processingBy: null,
      lastError: null,
      reviewedAt: params.now,
      reviewedBy: params.reviewer,
      updatedAt: params.now,
    })
    .where(
      and(
        eq(catalogSuggestions.id, params.id),
        or(eq(catalogSuggestions.status, "pending"), eq(catalogSuggestions.status, "failed")),
      ),
    )
    .returning();

  const suggestion = rejected[0];
  if (suggestion) {
    return { status: "rejected" as const, suggestion };
  }

  return {
    status: "skipped" as const,
    suggestion: await getSuggestionOrThrow(params.db, params.id),
  };
}

async function finalizeCatalogSuggestionApproval(params: {
  db: Db;
  id: string;
  reviewer: string;
  now: string;
  suggestion: SuggestionRow;
  result: ReviewApprovalResult;
}) {
  const writes = [
    params.db
      .update(catalogSuggestions)
      .set({
        status: "approved",
        processingStartedAt: null,
        processingBy: null,
        lastError: null,
        reviewedAt: params.now,
        reviewedBy: params.reviewer,
        updatedAt: params.now,
      })
      .where(eq(catalogSuggestions.id, params.id)),
    params.db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "catalog_suggestion_approved",
      actorType: "admin",
      actorId: params.reviewer,
      targetType: "catalog_suggestion",
      targetId: params.id,
      payloadJson: buildSuggestionAuditPayload(params.suggestion),
      createdAt: params.now,
    }),
    ...params.result.auditEntries.map((entry) =>
      params.db.insert(auditLog).values({
        id: generateId(idPrefixes.auditLog),
        createdAt: params.now,
        ...entry,
      }),
    ),
  ];

  await params.db.batch(writes as [(typeof writes)[0], ...typeof writes]);
}

async function markCatalogSuggestionApprovalFailed(params: {
  db: Db;
  id: string;
  reviewer: string;
  now: string;
  suggestion: SuggestionRow;
  errorMessage: string;
}) {
  await params.db.batch([
    params.db
      .update(catalogSuggestions)
      .set({
        status: "failed",
        processingStartedAt: null,
        processingBy: null,
        lastError: params.errorMessage,
        reviewedAt: null,
        reviewedBy: null,
        updatedAt: params.now,
      })
      .where(eq(catalogSuggestions.id, params.id)),
    params.db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "catalog_suggestion_approval_failed",
      actorType: "admin",
      actorId: params.reviewer,
      targetType: "catalog_suggestion",
      targetId: params.id,
      payloadJson: buildSuggestionAuditPayload(params.suggestion, {
        errorMessage: params.errorMessage,
      }),
      createdAt: params.now,
    }),
  ]);
}

export async function runApprovalPostCommitJobs(params: {
  db: Db;
  jobs: ReviewPostCommitJob[];
  scheduleSourceFetchJob?: typeof scheduleSourceFetch;
  scheduleRecomputeLatestJob?: typeof scheduleRecomputeLatest;
}) {
  const failures: ReviewPostCommitJobFailure[] = [];

  for (const job of params.jobs) {
    const scheduleSourceFetchJob = params.scheduleSourceFetchJob ?? scheduleSourceFetch;
    const scheduleRecomputeLatestJob = params.scheduleRecomputeLatestJob ?? scheduleRecomputeLatest;
    const result =
      job.type === "source-fetch"
        ? await scheduleSourceFetchJob({
            db: params.db,
            sourceId: job.sourceId,
            reason: job.reason,
            force: job.force,
          })
        : await scheduleRecomputeLatestJob({
            db: params.db,
            appId: job.appId,
            channel: job.channel,
          });

    if (!result.ok) {
      failures.push({
        job,
        errorMessage: result.errorMessage ?? "Unknown follow-up queue failure",
      });
      log.error("review approval post-commit job failed", {
        jobType: job.type,
        relatedId: job.type === "source-fetch" ? job.sourceId : job.appId,
        jobKey: job.type === "recompute-latest" ? job.channel : null,
        errorMessage: result.errorMessage,
      });
    }
  }

  return failures;
}

function describeReviewPostCommitJob(job: ReviewPostCommitJob) {
  if (job.type === "source-fetch") {
    return `source fetch for ${job.sourceId}`;
  }

  const channelLabel = job.channel ? ` (${job.channel})` : "";
  return `recompute latest for ${job.appId}${channelLabel}`;
}

export function summarizeReviewPostCommitFailures(failures: ReviewPostCommitJobFailure[]) {
  return `Failed to queue follow-up jobs: ${failures
    .map((failure) => `${describeReviewPostCommitJob(failure.job)}: ${failure.errorMessage}`)
    .join("; ")}`;
}

async function captureAdminEventSafely(
  actor: { id: string },
  event: string,
  properties: Record<string, unknown>,
) {
  try {
    await captureAdminEvent(actor, event, properties);
  } catch (error) {
    log.error("failed to capture admin analytics event", {
      event,
      properties,
      error,
    });
  }
}

async function persistCatalogSuggestionApprovalFailure(params: {
  db: Db;
  id: string;
  reviewer: string;
  now: string;
  suggestion: SuggestionRow;
  errorMessage: string;
  captureAdminEvent: ReviewAnalyticsCapture;
  failureStage: "approval" | "post_commit" | "finalize";
  extraEventProperties?: Record<string, unknown>;
}) {
  try {
    await markCatalogSuggestionApprovalFailed({
      db: params.db,
      id: params.id,
      reviewer: params.reviewer,
      now: params.now,
      suggestion: params.suggestion,
      errorMessage: params.errorMessage,
    });
  } catch (markFailedError) {
    log.error("failed to persist catalog suggestion approval failure", {
      suggestionId: params.id,
      errorMessage: params.errorMessage,
      markFailedError,
    });
  }

  await params.captureAdminEvent({ id: params.reviewer }, "review_approval_failed", {
    target_type: "catalog_suggestion",
    target_id: params.id,
    queue_type: params.suggestion.queueType,
    app_id: params.suggestion.appId ?? null,
    source_id: params.suggestion.sourceId ?? null,
    status: "failed",
    failure_stage: params.failureStage,
    error_message: params.errorMessage,
    ...params.extraEventProperties,
  });
}

export async function processCatalogSuggestionApproval(params: {
  db: Db;
  id: string;
  reviewer: string;
  now: string;
  cacheEnv: Pick<Env, "CACHE_KV">;
  dependencies?: Partial<ReviewApprovalDependencies>;
}) {
  const dependencies: ReviewApprovalDependencies = {
    captureAdminEvent: captureAdminEventSafely,
    invalidateInventoryMatchSnapshot,
    scheduleSourceFetch,
    scheduleRecomputeLatest,
    ...params.dependencies,
  };

  const claim = await claimCatalogSuggestionApproval({
    db: params.db,
    id: params.id,
    reviewer: params.reviewer,
    now: params.now,
  });

  if (claim.status === "skipped") {
    return { status: claim.suggestion.status };
  }

  let approvalResult: ReviewApprovalResult;
  try {
    approvalResult = await applySuggestionApproval({
      db: params.db,
      suggestion: claim.suggestion,
      reviewer: params.reviewer,
      now: params.now,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await persistCatalogSuggestionApprovalFailure({
      db: params.db,
      id: params.id,
      reviewer: params.reviewer,
      now: params.now,
      suggestion: claim.suggestion,
      errorMessage,
      captureAdminEvent: dependencies.captureAdminEvent,
      failureStage: "approval",
    });
    throw new Error(errorMessage, { cause: error });
  }

  if (approvalResult.invalidateInventorySnapshot) {
    await dependencies.invalidateInventoryMatchSnapshot(params.cacheEnv);
  }

  const postCommitFailures = await runApprovalPostCommitJobs({
    db: params.db,
    jobs: approvalResult.postCommitJobs,
    scheduleSourceFetchJob: dependencies.scheduleSourceFetch,
    scheduleRecomputeLatestJob: dependencies.scheduleRecomputeLatest,
  });

  if (postCommitFailures.length > 0) {
    const errorMessage = summarizeReviewPostCommitFailures(postCommitFailures);
    await persistCatalogSuggestionApprovalFailure({
      db: params.db,
      id: params.id,
      reviewer: params.reviewer,
      now: params.now,
      suggestion: claim.suggestion,
      errorMessage,
      captureAdminEvent: dependencies.captureAdminEvent,
      failureStage: "post_commit",
      extraEventProperties: {
        post_commit_failures: postCommitFailures.map((failure) => ({
          job_type: failure.job.type,
          related_id:
            failure.job.type === "source-fetch" ? failure.job.sourceId : failure.job.appId,
          job_key: failure.job.type === "recompute-latest" ? failure.job.channel : null,
          error_message: failure.errorMessage,
        })),
      },
    });
    throw new Error(errorMessage);
  }

  try {
    await finalizeCatalogSuggestionApproval({
      db: params.db,
      id: params.id,
      reviewer: params.reviewer,
      now: params.now,
      suggestion: claim.suggestion,
      result: approvalResult,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await persistCatalogSuggestionApprovalFailure({
      db: params.db,
      id: params.id,
      reviewer: params.reviewer,
      now: params.now,
      suggestion: claim.suggestion,
      errorMessage,
      captureAdminEvent: dependencies.captureAdminEvent,
      failureStage: "finalize",
    });
    throw new Error(errorMessage, { cause: error });
  }

  await dependencies.captureAdminEvent({ id: params.reviewer }, "review_approved", {
    target_type: "catalog_suggestion",
    target_id: params.id,
    queue_type: claim.suggestion.queueType,
    app_id: claim.suggestion.appId ?? null,
    source_id: claim.suggestion.sourceId ?? null,
    status: "approved",
    post_commit_failures: 0,
  });

  return { status: "approved" as const };
}

export const listCatalogSuggestions = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(listSuggestionsSchema)
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const conditions = [eq(catalogSuggestions.status, data.status)];
    if (data.queueType) {
      conditions.push(eq(catalogSuggestions.queueType, data.queueType));
    }
    const where = and(...conditions);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(catalogSuggestions)
      .where(where);
    const orderBy = catalogSuggestionOrderBy(data.sortBy, data.sortDir);

    const items = await db
      .select()
      .from(catalogSuggestions)
      .where(where)
      .orderBy(...orderBy)
      .limit(data.limit)
      .offset(data.offset);

    const [appMap, sourceMap] = await Promise.all([
      loadAppsByIds(
        db,
        items.map((item) => item.appId),
      ),
      loadSourcesByIds(
        db,
        items.map((item) => item.sourceId),
      ),
    ]);
    const sourceAppMap = await loadAppsByIds(
      db,
      [...sourceMap.values()].map((source) => source.appId),
    );

    return {
      items: items.map((item) => {
        const source = item.sourceId ? (sourceMap.get(item.sourceId) ?? null) : null;
        return Object.assign({}, item, {
          app: item.appId
            ? appMap.get(item.appId)
              ? toAppSummary(appMap.get(item.appId)!)
              : null
            : null,
          source:
            source && source.appId
              ? toSourceSummary(source, sourceAppMap.get(source.appId) ?? null)
              : null,
        });
      }),
      total: countResult?.count ?? 0,
      limit: data.limit,
      offset: data.offset,
    };
  });

export const getCatalogSuggestion = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const suggestion = await db
      .select()
      .from(catalogSuggestions)
      .where(eq(catalogSuggestions.id, id))
      .get();
    if (!suggestion) throw new Error("Not found");

    const evidence = await db
      .select()
      .from(suggestionEvidence)
      .where(eq(suggestionEvidence.suggestionId, id))
      .orderBy(desc(suggestionEvidence.observedAt), desc(suggestionEvidence.createdAt))
      .all();

    const [appMap, sourceMap] = await Promise.all([
      loadAppsByIds(db, [suggestion.appId]),
      loadSourcesByIds(db, [suggestion.sourceId]),
    ]);
    const source = suggestion.sourceId ? (sourceMap.get(suggestion.sourceId) ?? null) : null;
    const sourceAppMap = await loadAppsByIds(db, source ? [source.appId] : []);

    return {
      ...suggestion,
      app: suggestion.appId
        ? appMap.get(suggestion.appId)
          ? toAppSummary(appMap.get(suggestion.appId)!)
          : null
        : null,
      source:
        source && source.appId
          ? toSourceSummary(source, sourceAppMap.get(source.appId) ?? null)
          : null,
      evidence,
    };
  });

export const approveCatalogSuggestion = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id }, context }) => {
    return processCatalogSuggestionApproval({
      db: createDb(env.DB),
      id,
      reviewer: context.user.email,
      now: new Date().toISOString(),
      cacheEnv: env,
    });
  });

export const rejectCatalogSuggestion = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id }, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const result = await rejectCatalogSuggestionIfClaimable({
      db,
      id,
      reviewer: context.user.email,
      now,
    });
    if (result.status === "skipped") {
      return { status: result.suggestion.status };
    }

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "catalog_suggestion_rejected",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "catalog_suggestion",
      targetId: id,
      payloadJson: buildSuggestionAuditPayload(result.suggestion),
      createdAt: now,
    });
    await captureAdminEventSafely(context.user, "review_rejected", {
      target_type: "catalog_suggestion",
      target_id: id,
      queue_type: result.suggestion.queueType,
      app_id: result.suggestion.appId ?? null,
      source_id: result.suggestion.sourceId ?? null,
      status: "rejected",
    });

    return { status: "rejected" };
  });
