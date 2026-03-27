import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { updateExecutions } from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import {
  loadAppsByIds,
  loadReleasesByIds,
  toAppSummary,
  toReleaseSummary,
} from "./entity-summaries";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function executionOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "actionType":
      return [direction(updateExecutions.actionType), desc(updateExecutions.initiatedAt)];
    case "actionStatus":
      return [direction(updateExecutions.actionStatus), desc(updateExecutions.initiatedAt)];
    case "durationMs":
      return [direction(updateExecutions.durationMs), desc(updateExecutions.initiatedAt)];
    case "initiatedAt":
    default:
      return [desc(updateExecutions.initiatedAt)];
  }
}

export const listExecutions = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      appId: z.string().optional(),
      actionStatus: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    const conditions = [];
    if (data.appId) conditions.push(eq(updateExecutions.appId, data.appId));
    if (data.actionStatus)
      conditions.push(
        eq(
          updateExecutions.actionStatus,
          data.actionStatus as "initiated" | "in_progress" | "completed" | "failed" | "cancelled",
        ),
      );

    const where = conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined;

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(updateExecutions)
      .where(where);
    const items = await db
      .select()
      .from(updateExecutions)
      .where(where)
      .orderBy(...executionOrderBy(data.sortBy, data.sortDir))
      .limit(limit)
      .offset(offset);
    const [appMap, releaseMap] = await Promise.all([
      loadAppsByIds(
        db,
        items.map((item) => item.appId),
      ),
      loadReleasesByIds(
        db,
        items.map((item) => item.releaseId),
      ),
    ]);

    return {
      items: items.map((item) => {
        const app = appMap.get(item.appId) ?? null;
        const release = releaseMap.get(item.releaseId) ?? null;

        return Object.assign({}, item, {
          app: app ? toAppSummary(app) : null,
          release: release ? toReleaseSummary(release, app) : null,
        });
      }),
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  });

export const getExecutionDetail = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string() }))
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const item = await db
      .select()
      .from(updateExecutions)
      .where(eq(updateExecutions.id, data.id))
      .get();
    if (!item) throw new Error("Not found");
    const [appMap, releaseMap] = await Promise.all([
      loadAppsByIds(db, [item.appId]),
      loadReleasesByIds(db, [item.releaseId]),
    ]);
    const app = appMap.get(item.appId) ?? null;
    const release = releaseMap.get(item.releaseId) ?? null;

    return {
      ...item,
      app: app ? toAppSummary(app) : null,
      release: release ? toReleaseSummary(release, app) : null,
    };
  });

export const getExecutionStats = createServerFn({ method: "GET" }).handler(async () => {
  const db = createDb(env.DB);

  const [totalCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(updateExecutions)
    .where(sql`${updateExecutions.initiatedAt} > datetime('now', '-7 days')`);
  const [failedCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(updateExecutions)
    .where(
      sql`${updateExecutions.actionStatus} = 'failed' AND ${updateExecutions.initiatedAt} > datetime('now', '-7 days')`,
    );

  return {
    recentExecutions: totalCount?.count ?? 0,
    failedExecutions: failedCount?.count ?? 0,
  };
});
