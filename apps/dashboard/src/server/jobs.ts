import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { createDb } from "@versioneer/db";
import { cronJobRuns } from "@versioneer/db";

import { runCaskIndexSyncJob, runPollSourcesJob, startEnrichmentDrainJob } from "./job-runners";
import { authMiddleware } from "./middleware";

const cronJobTypeSchema = z.enum(["poll_sources", "cask_index_sync", "enrich_discovered_apps"]);
const cronTriggerSchema = z.enum(["manual", "scheduled"]);
const cronRunStatusSchema = z.enum(["running", "completed", "failed"]);
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
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      jobType: cronJobTypeSchema.optional(),
      trigger: cronTriggerSchema.optional(),
      status: cronRunStatusSchema.optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, jobType, trigger, status, sortBy, sortDir } = data;
    const db = createDb(env.DB);
    const filters = [];
    if (jobType) filters.push(eq(cronJobRuns.jobType, jobType));
    if (trigger) filters.push(eq(cronJobRuns.trigger, trigger));
    if (status) filters.push(eq(cronJobRuns.status, status));
    const where = filters.length > 0 ? and(...filters) : undefined;

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
  .handler(async ({ data: { force }, context }) =>
    runPollSourcesJob({
      db: createDb(env.DB),
      force,
      actorId: context.user.email,
      trigger: "manual",
    }),
  );

export const triggerCaskSync = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) =>
    runCaskIndexSyncJob({
      db: createDb(env.DB),
      actorId: context.user.email,
      trigger: "manual",
    }),
  );

export const triggerEnrichDiscoveries = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) =>
    startEnrichmentDrainJob({
      db: createDb(env.DB),
      actorId: context.user.email,
      trigger: "manual",
    }),
  );
