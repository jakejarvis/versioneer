import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { gt, inArray, sql } from "drizzle-orm";

import { attentionCatalogSuggestionStatuses } from "@/lib/review-lifecycle";
import { createDb } from "@versioneer/db";
import {
  apps,
  sources,
  jobFailures,
  releases,
  clientFeedback,
  discoveredApps,
  catalogSuggestions,
} from "@versioneer/db";

import { openOperationalJobFailureCondition } from "./job-failure-filters";
import { authMiddleware } from "./middleware";

export const getStats = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const db = createDb(env.DB);
    const recentReleaseThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

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
      .where(openOperationalJobFailureCondition());
    const [recentReleaseCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(releases)
      .where(gt(releases.createdAt, recentReleaseThreshold));

    const [publicCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(apps)
      .where(sql`${apps.status} = 'public'`);

    const [pendingFeedbackCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(clientFeedback)
      .where(sql`${clientFeedback.status} = 'new'`);

    const [pendingDiscoveredCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(discoveredApps)
      .where(sql`${discoveredApps.status} = 'pending'`);

    const [pendingSuggestionCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(catalogSuggestions)
      .where(inArray(catalogSuggestions.status, attentionCatalogSuggestionStatuses));

    return {
      totalApps: appCount?.count ?? 0,
      activeSources: activeSourceCount?.count ?? 0,
      errorSources: errorSourceCount?.count ?? 0,
      openFailures: openFailureCount?.count ?? 0,
      recentReleases: recentReleaseCount?.count ?? 0,
      publicApps: publicCount?.count ?? 0,
      pendingFeedback: pendingFeedbackCount?.count ?? 0,
      pendingDiscoveredApps: pendingDiscoveredCount?.count ?? 0,
      pendingCatalogSuggestions: pendingSuggestionCount?.count ?? 0,
    };
  });
