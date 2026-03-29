import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { enrichDiscoveredApp } from "@versioneer/pipeline";
import { discoveredApps, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { asc, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { authMiddleware } from "./middleware";

const sortDirectionSchema = z.enum(["asc", "desc"]).optional();

function discoveredAppOrderBy(sortBy?: string, sortDir?: "asc" | "desc") {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "confidenceScore":
      return [direction(discoveredApps.confidenceScore), desc(discoveredApps.sightingCount)];
    case "appName":
      return [direction(discoveredApps.appName), desc(discoveredApps.lastSeenAt)];
    case "status":
      return [direction(discoveredApps.status), desc(discoveredApps.lastSeenAt)];
    case "lastSeenAt":
      return [direction(discoveredApps.lastSeenAt), desc(discoveredApps.sightingCount)];
    case "sightingCount":
    default:
      return [desc(discoveredApps.sightingCount), desc(discoveredApps.lastSeenAt)];
  }
}

export const listDiscoveredApps = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["pending", "linked", "dismissed", "support_only"]).default("pending"),
      sortBy: z.string().optional(),
      sortDir: sortDirectionSchema,
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, status, sortBy, sortDir } = data;
    const db = createDb(env.DB);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(discoveredApps)
      .where(eq(discoveredApps.status, status));
    const items = await db
      .select()
      .from(discoveredApps)
      .where(eq(discoveredApps.status, status))
      .orderBy(...discoveredAppOrderBy(sortBy, sortDir))
      .limit(limit)
      .offset(offset);

    return { items, total: countResult?.count ?? 0, limit, offset };
  });

export const dismissDiscoveredApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id }, context }) => {
    const db = createDb(env.DB);
    const item = await db.select().from(discoveredApps).where(eq(discoveredApps.id, id)).get();
    if (!item) throw new Error("Not found");

    const now = new Date().toISOString();
    await db
      .update(discoveredApps)
      .set({
        status: "dismissed",
        dismissedAt: now,
        dismissedBy: context.user.email,
        updatedAt: now,
      })
      .where(eq(discoveredApps.id, id));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "discovered_app_dismissed",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "discovered_app",
      targetId: id,
      payloadJson: JSON.stringify({ appName: item.appName, bundleId: item.bundleId }),
      createdAt: now,
    });

    return { status: "dismissed" };
  });

// GET single discovered app by ID (with all enrichment data)
export const getDiscoveredApp = createServerFn({ method: "GET" })
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const item = await db.select().from(discoveredApps).where(eq(discoveredApps.id, id)).get();
    if (!item) throw new Error("Not found");
    return item;
  });

// POST re-enrich a discovered app (manual trigger)
export const reEnrichDiscoveredApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(z.object({ id: z.string().min(1) }))
  .handler(async ({ data: { id } }) => {
    const db = createDb(env.DB);
    const result = await enrichDiscoveredApp({
      discoveredAppId: id,
      db,
      githubToken: env.GITHUB_TOKEN,
      assetsBucket: env.ASSETS_BUCKET,
      configKv: env.CONFIG_KV,
    });
    return result;
  });
