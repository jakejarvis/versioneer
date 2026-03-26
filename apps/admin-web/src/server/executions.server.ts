import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { updateExecutions } from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { eq, sql, desc } from "drizzle-orm";
import { z } from "zod";

export const listExecutions = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      appId: z.string().optional(),
      actionStatus: z.string().optional(),
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
      .orderBy(desc(updateExecutions.initiatedAt))
      .limit(limit)
      .offset(offset);

    return { items, total: countResult?.count ?? 0, limit, offset };
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
    return item;
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
