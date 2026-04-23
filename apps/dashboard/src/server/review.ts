import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, desc, eq, lte, or, sql } from "drizzle-orm";
import { z } from "zod";

import { REVIEW_APPROVAL_STALE_MS } from "@/lib/review-lifecycle";
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
  const staleBefore = new Date(Date.parse(params.now) - REVIEW_APPROVAL_STALE_MS).toISOString();
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
        or(
          eq(catalogSuggestions.status, "pending"),
          eq(catalogSuggestions.status, "failed"),
          and(
            eq(catalogSuggestions.status, "processing"),
            or(
              sql`${catalogSuggestions.processingStartedAt} is null`,
              lte(catalogSuggestions.processingStartedAt, staleBefore),
            ),
          ),
        ),
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

async function runApprovalPostCommitJobs(params: { db: Db; jobs: ReviewPostCommitJob[] }) {
  let failedJobs = 0;

  for (const job of params.jobs) {
    const result =
      job.type === "source-fetch"
        ? await scheduleSourceFetch({
            db: params.db,
            sourceId: job.sourceId,
            reason: job.reason,
            force: job.force,
          })
        : await scheduleRecomputeLatest({
            db: params.db,
            appId: job.appId,
            channel: job.channel,
          });

    if (!result.ok) {
      failedJobs += 1;
      log.error("review approval post-commit job failed", {
        jobType: job.type,
        relatedId: job.type === "source-fetch" ? job.sourceId : job.appId,
        jobKey: job.type === "recompute-latest" ? job.channel : null,
        errorMessage: result.errorMessage,
      });
    }
  }

  return failedJobs;
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
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const claim = await claimCatalogSuggestionApproval({
      db,
      id,
      reviewer: context.user.email,
      now,
    });

    if (claim.status === "skipped") {
      return { status: claim.suggestion.status };
    }

    let approvalResult: ReviewApprovalResult;
    try {
      approvalResult = await applySuggestionApproval({
        db,
        suggestion: claim.suggestion,
        reviewer: context.user.email,
        now,
      });

      await finalizeCatalogSuggestionApproval({
        db,
        id,
        reviewer: context.user.email,
        now,
        suggestion: claim.suggestion,
        result: approvalResult,
      });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      try {
        await markCatalogSuggestionApprovalFailed({
          db,
          id,
          reviewer: context.user.email,
          now,
          suggestion: claim.suggestion,
          errorMessage,
        });
      } catch (markFailedError) {
        log.error("failed to persist catalog suggestion approval failure", {
          suggestionId: id,
          errorMessage,
          markFailedError,
        });
      }

      await captureAdminEventSafely(context.user, "review_approval_failed", {
        target_type: "catalog_suggestion",
        target_id: id,
        queue_type: claim.suggestion.queueType,
        app_id: claim.suggestion.appId ?? null,
        source_id: claim.suggestion.sourceId ?? null,
        status: "failed",
        error_message: errorMessage,
      });
      throw new Error(errorMessage, { cause: error });
    }

    if (approvalResult.invalidateInventorySnapshot) {
      await invalidateInventoryMatchSnapshot(env);
    }
    const postCommitFailures = await runApprovalPostCommitJobs({
      db,
      jobs: approvalResult.postCommitJobs,
    });
    await captureAdminEventSafely(context.user, "review_approved", {
      target_type: "catalog_suggestion",
      target_id: id,
      queue_type: claim.suggestion.queueType,
      app_id: claim.suggestion.appId ?? null,
      source_id: claim.suggestion.sourceId ?? null,
      status: "approved",
      post_commit_failures: postCommitFailures,
    });

    return { status: "approved" };
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
