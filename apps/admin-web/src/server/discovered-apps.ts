import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import { discoveredApps, auditLog, generateId, idPrefixes } from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { autoCreateSourcesForDiscoveredApp } from "./auto-source";
import { authMiddleware } from "./middleware";

export const listDiscoveredApps = createServerFn({ method: "GET" })
  .inputValidator(
    z.object({
      limit: z.number().int().min(1).max(100).default(50),
      offset: z.number().int().min(0).default(0),
      status: z.enum(["pending", "approved", "dismissed"]).default("pending"),
    }),
  )
  .handler(async ({ data }) => {
    const { limit, offset, status } = data;
    const db = createDb(env.DB);

    const [countResult] = await db
      .select({ count: sql<number>`count(*)` })
      .from(discoveredApps)
      .where(eq(discoveredApps.status, status));
    const items = await db
      .select()
      .from(discoveredApps)
      .where(eq(discoveredApps.status, status))
      .orderBy(desc(discoveredApps.sightingCount), desc(discoveredApps.lastSeenAt))
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

export const approveDiscoveredApp = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .inputValidator(
    z.object({
      id: z.string().min(1),
      appId: z.string().min(1),
    }),
  )
  .handler(async ({ data, context }) => {
    const { id, appId } = data;
    const db = createDb(env.DB);
    const item = await db.select().from(discoveredApps).where(eq(discoveredApps.id, id)).get();
    if (!item) throw new Error("Not found");

    const now = new Date().toISOString();
    await db
      .update(discoveredApps)
      .set({
        status: "approved",
        onboardedAppId: appId,
        updatedAt: now,
      })
      .where(eq(discoveredApps.id, id));

    await db.insert(auditLog).values({
      id: generateId(idPrefixes.auditLog),
      eventType: "discovered_app_approved",
      actorType: "admin",
      actorId: context.user.email,
      targetType: "discovered_app",
      targetId: id,
      payloadJson: JSON.stringify({ appName: item.appName, bundleId: item.bundleId, appId }),
      createdAt: now,
    });

    // Auto-create sources from discovered app metadata (Sparkle feed, GitHub releases)
    const autoResult = await autoCreateSourcesForDiscoveredApp({
      discoveredApp: item,
      appId,
      actorEmail: context.user.email,
      db,
    });

    return { status: "approved", autoCreatedSources: autoResult.created };
  });
