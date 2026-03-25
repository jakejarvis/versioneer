import { createDb } from "@versioneer/db";
import { auditLog } from "@versioneer/schema";
import { paginationSchema } from "@versioneer/validation";
import { eq, and, sql, desc } from "drizzle-orm";
import { Hono } from "hono";

import type { AppEnv } from "../../env";

export const auditLogRoutes = new Hono<AppEnv>();

// GET /audit-log - list
auditLogRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);
  const { limit, offset } = paginationSchema.parse({
    limit: c.req.query("limit"),
    offset: c.req.query("offset"),
  });
  const eventType = c.req.query("eventType");
  const targetType = c.req.query("targetType");

  const conditions = [];
  if (eventType) conditions.push(eq(auditLog.eventType, eventType));
  if (targetType) conditions.push(eq(auditLog.targetType, targetType));

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const [countResult] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditLog)
    .where(where);
  const items = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});
