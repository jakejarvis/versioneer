import { Hono } from "hono";
import { sql } from "drizzle-orm";
import type { Env } from "../../env";
import { createDb } from "@macupdater/db";
import { apps, sources, reviewQueue, jobFailures, releases } from "@macupdater/schema";

export const statsRoutes = new Hono<{ Bindings: Env }>();

statsRoutes.get("/", async (c) => {
  const db = createDb(c.env.DB);

  const [appCount] = await db.select({ count: sql<number>`count(*)` }).from(apps);
  const [activeSourceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sources)
    .where(sql`${sources.status} = 'active'`);
  const [errorSourceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sources)
    .where(sql`${sources.status} = 'error'`);
  const [pendingReviewCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(reviewQueue)
    .where(sql`${reviewQueue.status} = 'pending'`);
  const [openFailureCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(jobFailures)
    .where(sql`${jobFailures.status} = 'open'`);
  const [recentReleaseCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(releases)
    .where(sql`${releases.createdAt} > datetime('now', '-7 days')`);

  return c.json({
    totalApps: appCount?.count ?? 0,
    activeSources: activeSourceCount?.count ?? 0,
    errorSources: errorSourceCount?.count ?? 0,
    pendingReviews: pendingReviewCount?.count ?? 0,
    openFailures: openFailureCount?.count ?? 0,
    recentReleases: recentReleaseCount?.count ?? 0,
  });
});
