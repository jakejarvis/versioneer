import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createDb } from "@versioneer/db";
import {
  auditLog,
  catalogSuggestions,
  generateId,
  idPrefixes,
  suggestionEvidence,
} from "@versioneer/db";

import { captureAdminEvent } from "./analytics";
import { invalidateInventoryMatchSnapshot } from "./cache";
import { loadAppsByIds, loadSourcesByIds, toAppSummary, toSourceSummary } from "./entity-summaries";
import { authMiddleware } from "./middleware";
import { catalogSuggestionOrderBy } from "./order-by";
import { applySuggestionApproval } from "./review-approval";

const suggestionStatusSchema = z.enum(["pending", "approved", "rejected", "superseded"]);
const suggestionQueueTypeSchema = z.enum([
  "new_app",
  "new_source",
  "metadata_change",
  "authority_handoff",
  "merge_proposal",
  "release_discrepancy",
]);

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

const listSuggestionsSchema = z.object({
  limit: z.number().int().min(1).max(100).default(25),
  offset: z.number().int().min(0).default(0),
  status: suggestionStatusSchema.default("pending"),
  queueType: suggestionQueueTypeSchema.optional(),
  sortBy: z.string().optional(),
  sortDir: sortDirectionSchema,
});

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
    const suggestion = await db
      .select()
      .from(catalogSuggestions)
      .where(eq(catalogSuggestions.id, id))
      .get();
    if (!suggestion) throw new Error("Not found");
    if (suggestion.status !== "pending") {
      return { status: suggestion.status };
    }

    await applySuggestionApproval({
      db,
      suggestion,
      reviewer: context.user.email,
      now,
    });

    await db
      .update(catalogSuggestions)
      .set({
        status: "approved",
        reviewedAt: now,
        reviewedBy: context.user.email,
        updatedAt: now,
      })
      .where(eq(catalogSuggestions.id, id));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "catalog_suggestion_approved",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "catalog_suggestion",
      targetId: id,
      payloadJson: JSON.stringify({
        queueType: suggestion.queueType,
        appId: suggestion.appId,
        sourceId: suggestion.sourceId,
      }),
      createdAt: now,
    });
    await invalidateInventoryMatchSnapshot(env);
    await captureAdminEvent(context.user, "review_approved", {
      target_type: "catalog_suggestion",
      target_id: id,
      queue_type: suggestion.queueType,
      app_id: suggestion.appId ?? null,
      source_id: suggestion.sourceId ?? null,
      status: "approved",
    });

    return { status: "approved" };
  });

export const rejectCatalogSuggestion = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id }, context }) => {
    const db = createDb(env.DB);
    const now = new Date().toISOString();
    const suggestion = await db
      .select()
      .from(catalogSuggestions)
      .where(eq(catalogSuggestions.id, id))
      .get();
    if (!suggestion) throw new Error("Not found");
    if (suggestion.status !== "pending") {
      return { status: suggestion.status };
    }

    await db
      .update(catalogSuggestions)
      .set({
        status: "rejected",
        reviewedAt: now,
        reviewedBy: context.user.email,
        updatedAt: now,
      })
      .where(eq(catalogSuggestions.id, id));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "catalog_suggestion_rejected",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "catalog_suggestion",
      targetId: id,
      payloadJson: JSON.stringify({
        queueType: suggestion.queueType,
        appId: suggestion.appId,
        sourceId: suggestion.sourceId,
      }),
      createdAt: now,
    });
    await captureAdminEvent(context.user, "review_rejected", {
      target_type: "catalog_suggestion",
      target_id: id,
      queue_type: suggestion.queueType,
      app_id: suggestion.appId ?? null,
      source_id: suggestion.sourceId ?? null,
      status: "rejected",
    });

    return { status: "rejected" };
  });
