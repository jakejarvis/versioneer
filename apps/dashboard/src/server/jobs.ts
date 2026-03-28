import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { cronJobRuns, generateId, idPrefixes, sources } from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function cronJobRunOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "jobType":
      return [direction(cronJobRuns.jobType), desc(cronJobRuns.startedAt)];
    case "trigger":
      return [direction(cronJobRuns.trigger), desc(cronJobRuns.startedAt)];
    case "status":
      return [direction(cronJobRuns.status), desc(cronJobRuns.startedAt)];
    case "startedAt":
    default:
      return [desc(cronJobRuns.startedAt)];
  }
}

export const listCronJobRuns = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      jobType: z.enum(["poll_sources", "cask_index_sync"]).optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, jobType, sortBy, sortDir } = data;
    const db = createDb(env.DB);

    const where = jobType ? eq(cronJobRuns.jobType, jobType) : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(cronJobRuns)
      .where(where);
    const items = await db
      .select()
      .from(cronJobRuns)
      .where(where)
      .orderBy(...cronJobRunOrderBy(sortBy, sortDir))
      .limit(limit)
      .offset(offset);

    return { items, total: countResult?.count ?? 0, limit, offset };
  });

export const triggerPollSources = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ force: z.boolean().default(false) }))
  .handler(async ({ data: { force }, context }) => {
    const db = createDb(env.DB);
    const now = new Date();
    const runId = generateId(idPrefixes.cronJobRun);

    await db.insert(cronJobRuns).values({
      id: runId,
      jobType: "poll_sources",
      trigger: "manual",
      status: "running",
      actorId: context.user.email,
      startedAt: now.toISOString(),
    });

    try {
      const activeSources = await db
        .select()
        .from(sources)
        .where(eq(sources.status, "active"))
        .all();

      const dueSources = force
        ? activeSources
        : activeSources.filter((source) => {
            const lastFetched = source.lastFetchedAt ? new Date(source.lastFetchedAt) : null;
            const intervalMs = source.pollIntervalMinutes * 60 * 1000;
            return !lastFetched || now.getTime() - lastFetched.getTime() >= intervalMs;
          });

      for (const source of dueSources) {
        await env.SOURCE_FETCH_QUEUE.send({
          sourceId: source.id,
          reason: "manual",
          force,
        });
      }

      await db
        .update(cronJobRuns)
        .set({
          status: "completed",
          itemsQueued: dueSources.length,
          itemsTotal: activeSources.length,
          completedAt: new Date().toISOString(),
        })
        .where(eq(cronJobRuns.id, runId));

      return {
        id: runId,
        status: "completed" as const,
        itemsQueued: dueSources.length,
        itemsTotal: activeSources.length,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await db
        .update(cronJobRuns)
        .set({
          status: "failed",
          errorMessage,
          completedAt: new Date().toISOString(),
        })
        .where(eq(cronJobRuns.id, runId));
      throw error;
    }
  });

export const triggerCaskSync = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const db = createDb(env.DB);
    const runId = generateId(idPrefixes.cronJobRun);

    try {
      await env.CASK_INDEX_SYNC_QUEUE.send({ reason: "manual", force: true });

      await db.insert(cronJobRuns).values({
        id: runId,
        jobType: "cask_index_sync",
        trigger: "manual",
        status: "completed",
        actorId: context.user.email,
        itemsQueued: 1,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });

      return { id: runId, status: "completed" as const };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await db.insert(cronJobRuns).values({
        id: runId,
        jobType: "cask_index_sync",
        trigger: "manual",
        status: "failed",
        actorId: context.user.email,
        errorMessage,
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  });
