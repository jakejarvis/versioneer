import { createServerFn } from "@tanstack/react-start";
import { createDb } from "@versioneer/db";
import {
  apps,
  sources,
  jobFailures,
  releases,
  clientFeedback,
  discoveredApps,
} from "@versioneer/schema";
import { env } from "cloudflare:workers";
import { sql } from "drizzle-orm";

export const getStats = createServerFn({ method: "GET" }).handler(async () => {
  const db = createDb(env.DB);

  const [appCount] = await db.select({ count: sql<number>`count(*)` }).from(apps);
  const [activeSourceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sources)
    .where(sql`${sources.status} = 'active'`);
  const [errorSourceCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(sources)
    .where(sql`${sources.status} = 'error'`);
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
    .where(sql`${apps.isVerified} = 1`);

  const [pendingFeedbackCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(clientFeedback)
    .where(sql`${clientFeedback.status} = 'new'`);

  const [pendingDiscoveredCount] = await db
    .select({ count: sql<number>`count(*)` })
    .from(discoveredApps)
    .where(sql`${discoveredApps.status} = 'pending'`);

  return {
    totalApps: appCount?.count ?? 0,
    activeSources: activeSourceCount?.count ?? 0,
    errorSources: errorSourceCount?.count ?? 0,
    openFailures: openFailureCount?.count ?? 0,
    recentReleases: recentReleaseCount?.count ?? 0,
    verifiedApps: verifiedCount?.count ?? 0,
    pendingFeedback: pendingFeedbackCount?.count ?? 0,
    pendingDiscoveredApps: pendingDiscoveredCount?.count ?? 0,
  };
});
