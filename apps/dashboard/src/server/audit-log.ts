import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { auditLog } from "@versioneer/db";
import { env } from "cloudflare:workers";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { resolveTargetRefs } from "./entity-summaries";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function auditLogOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "eventType":
      return [direction(auditLog.eventType), desc(auditLog.createdAt)];
    case "actorType":
      return [direction(auditLog.actorType), desc(auditLog.createdAt)];
    case "targetType":
      return [direction(auditLog.targetType), desc(auditLog.createdAt)];
    case "createdAt":
    default:
      return [desc(auditLog.createdAt)];
  }
}

export const listAuditLog = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().optional(),
      offset: z.number().optional(),
      eventType: z.string().optional(),
      targetType: z.string().optional(),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
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
      .orderBy(...auditLogOrderBy(data.sortBy, data.sortDir))
      .limit(limit)
      .offset(offset);
    const targetRefMap = await resolveTargetRefs(
      db,
      items.map((item) => ({
        targetType: item.targetType,
        targetId: item.targetId,
      })),
    );

    return {
      items: items.map((item) =>
        Object.assign({}, item, {
          targetRef: targetRefMap.get(`${item.targetType}:${item.targetId}`) ?? null,
        }),
      ),
      total: countResult?.count ?? 0,
      limit,
      offset,
    };
  });
