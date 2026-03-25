import { Hono } from "hono";
import { eq, and, sql, desc } from "drizzle-orm";
import type { Env } from "../../env";
import { createDb } from "@macupdater/db";
import { auditLog } from "@macupdater/schema";
import { paginationSchema } from "@macupdater/validation";

export const auditLogRoutes = new Hono<{ Bindings: Env }>();

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

  const [countResult] = await db.select({ count: sql<number>`count(*)` }).from(auditLog).where(where);
  const items = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt))
    .limit(limit)
    .offset(offset);

  return c.json({ items, total: countResult?.count ?? 0, limit, offset });
});
