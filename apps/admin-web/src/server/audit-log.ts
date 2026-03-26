import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { auditLog } from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { eq, and, sql, desc } from "drizzle-orm";
import { z } from "zod";

export const listAuditLog = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      eventType: z.string().optional(),
      targetType: z.string().optional(),
    }),
  )
  .handler(async ({ data }) => {
    const db = createDb(env.DB);
    const limit = data.limit ?? 50;
    const offset = data.offset ?? 0;

    const conditions = [];
    if (data.eventType) conditions.push(eq(auditLog.eventType, data.eventType));
    if (data.targetType) conditions.push(eq(auditLog.targetType, data.targetType));

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

    return { items, total: countResult?.count ?? 0, limit, offset };
  });
