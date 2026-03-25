import { createDb } from "@versioneer/db";
import {
  apps,
  sources,
  reviewQueue,
  jobFailures,
  releases,
  clientFeedback,
} from "@versioneer/schema";
import { sql } from "drizzle-orm";
import { Hono } from "hono";

import type { Env } from "../../env";

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

  const [verifiedCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(apps)
    .where(sql`${apps.verificationTier} = 'verified'`);
  const [greenCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(apps)
    .where(sql`${apps.qualityState} = 'green'`);
  const [yellowCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(apps)
    .where(sql`${apps.qualityState} = 'yellow'`);
  const [redCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(apps)
    .where(sql`${apps.qualityState} = 'red'`);

  const [pendingFeedbackCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(clientFeedback)
    .where(sql`${clientFeedback.status} = 'new'`);

  return c.json({
    totalApps: appCount?.count ?? 0,
    activeSources: activeSourceCount?.count ?? 0,
    errorSources: errorSourceCount?.count ?? 0,
    pendingReviews: pendingReviewCount?.count ?? 0,
    openFailures: openFailureCount?.count ?? 0,
    recentReleases: recentReleaseCount?.count ?? 0,
    verifiedApps: verifiedCount?.count ?? 0,
    greenApps: greenCount?.count ?? 0,
    yellowApps: yellowCount?.count ?? 0,
    redApps: redCount?.count ?? 0,
    pendingFeedback: pendingFeedbackCount?.count ?? 0,
  });
});
