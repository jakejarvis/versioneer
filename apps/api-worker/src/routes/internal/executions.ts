import { createDb } from "@versioneer/db";
import { updateExecutions } from "@versioneer/schema";
import { paginationSchema } from "@versioneer/validation";
import { eq, sql, desc } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../../env";

export const executionsRoutes = new Hono<{ Bindings: Env }>();

// GET /executions - list
executionsRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const appId = c.req.query("appId");
  const actionStatus = c.req.query("actionStatus");

  const conditions = [];
  if (appId) conditions.push(eq(updateExecutions.appId, appId));
  if (actionStatus)
    conditions.push(
      eq(
        updateExecutions.actionStatus,
        actionStatus as "initiated" | "in_progress" | "completed" | "failed" | "cancelled",
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

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});

// GET /executions/:id
executionsRoutes.get("/:id", async (c) => {
  const db = createDb(c.env.DB);
  const id = c.req.param("id");
  const item = await db.select().from(updateExecutions).where(eq(updateExecutions.id, id)).get();
  if (!item) return c.json({ error: "Execution not found" }, 404);
  return c.json(item);
});

// GET /executions/stats
executionsRoutes.get("/stats", async (c) => {
  const db = createDb(c.env.DB);

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

  return c.json({
    recentExecutions: totalCount?.count ?? 0,
    failedExecutions: failedCount?.count ?? 0,
  });
});
