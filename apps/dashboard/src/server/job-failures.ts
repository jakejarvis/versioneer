import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { jobFailures } from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { loadEntityRefsByIds } from "./entity-summaries";
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

// GET /job-failures - list with pagination, default status="open"
export const listJobFailures = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["open", "retrying", "resolved", "abandoned"]).default("open"),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, status, sortBy, sortDir } = data;
    const db = createDb(env.DB);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(jobFailures)
      .where(eq(jobFailures.status, status));
    const items = await db
      .select()
      .from(jobFailures)
      .where(eq(jobFailures.status, status))
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
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const item = await db.select().from(jobFailures).where(eq(jobFailures.id, id)).get();
    if (!item) throw new Error("Not found");
    return item;
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
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const failure = await db.select().from(jobFailures).where(eq(jobFailures.id, id)).get();
    if (!failure) throw new Error("Not found");

    // Re-enqueue based on job type
    switch (failure.jobType) {
      case "source-fetch":
        if (failure.relatedId) {
          await env.SOURCE_FETCH_QUEUE.send({
            sourceId: failure.relatedId,
            reason: "retry",
            force: true,
          });
        }
        break;
      case "source-parse":
        if (failure.relatedId) {
          await env.SOURCE_PARSE_QUEUE.send({ sourceFetchId: failure.relatedId });
        }
        break;
      case "recompute-latest":
        if (failure.relatedId) {
          await env.RECOMPUTE_LATEST_QUEUE.send({ appId: failure.relatedId });
        }
        break;
    }

    await db.update(jobFailures).set({ status: "retrying" }).where(eq(jobFailures.id, id));

    return { status: "retrying" };
  });

// POST /job-failures/retry-all - re-enqueue all open failures
export const retryAllJobFailures = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      jobType: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const { jobType } = data;
    const db = createDb(env.DB);

    const failures = await db
      .select()
      .from(jobFailures)
      .where(eq(jobFailures.status, "open"))
      .all();

    const matching = jobType ? failures.filter((f) => f.jobType === jobType) : failures;
    let retried = 0;

    for (const failure of matching) {
      switch (failure.jobType) {
        case "source-fetch":
          if (failure.relatedId) {
            await env.SOURCE_FETCH_QUEUE.send({
              sourceId: failure.relatedId,
              reason: "retry",
              force: true,
            });
            retried++;
          }
          break;
        case "source-parse":
          if (failure.relatedId) {
            await env.SOURCE_PARSE_QUEUE.send({ sourceFetchId: failure.relatedId });
            retried++;
          }
          break;
        case "recompute-latest":
          if (failure.relatedId) {
            await env.RECOMPUTE_LATEST_QUEUE.send({ appId: failure.relatedId });
            retried++;
          }
          break;
      }
      await db
        .update(jobFailures)
        .set({ status: "retrying" })
        .where(eq(jobFailures.id, failure.id));
    }

    return { status: "retrying", count: retried };
  });
