import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { handleCaskIndexSync } from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import { cronJobRuns, generateId, idPrefixes, sources } from "@versioneer/db";

import { scheduleSourceFetch } from "./followup-jobs";
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
      jobType: z.enum(["poll_sources", "cask_index_sync", "enrich_discovered_apps"]).optional(),
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

      const queuedSourceIds: string[] = [];
      const failedSources: Array<{ sourceId: string; errorMessage: string | null }> = [];
      for (const source of dueSources) {
        const result = await scheduleSourceFetch({
          db,
          sourceId: source.id,
          reason: "manual",
          force,
        });
        if (result.ok) {
          queuedSourceIds.push(source.id);
        } else {
          failedSources.push({
            sourceId: source.id,
            errorMessage: result.errorMessage ?? null,
          });
        }
      }

      const status = failedSources.length > 0 ? "failed" : "completed";
      const completedAt = new Date().toISOString();
      const resultJson = JSON.stringify({
        queuedSourceIds,
        failedSources,
      });

      await db
        .update(cronJobRuns)
        .set({
          status,
          itemsQueued: queuedSourceIds.length,
          itemsTotal: activeSources.length,
          resultJson,
          errorMessage:
            failedSources.length > 0
              ? `${failedSources.length} source enqueue${failedSources.length === 1 ? "" : "s"} failed`
              : null,
          completedAt,
        })
        .where(eq(cronJobRuns.id, runId));

      return {
        id: runId,
        status,
        itemsQueued: queuedSourceIds.length,
        itemsTotal: activeSources.length,
        failedCount: failedSources.length,
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
    const startedAt = new Date().toISOString();

    try {
      await handleCaskIndexSync({ reason: "manual", force: true }, env);

      await db.insert(cronJobRuns).values({
        id: runId,
        jobType: "cask_index_sync",
        trigger: "manual",
        status: "completed",
        actorId: context.user.email,
        itemsQueued: 1,
        startedAt,
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
        startedAt,
        completedAt: new Date().toISOString(),
      });
      throw error;
    }
  });
