import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { asc, desc, eq, gt, inArray, sql } from "drizzle-orm";

import { attentionCatalogSuggestionStatuses } from "@/lib/review-lifecycle";
import type {
  DashboardHomepageData,
  FeedbackListItem,
  HomepageDiscoveryItem,
  HomepageRunItem,
  JobFailureListItem,
  ReleaseListItem,
} from "@/lib/types";
import { createDb } from "@versioneer/db";
import {
  apps,
  appLatestReleases,
  catalogSuggestions,
  clientFeedback,
  cronJobRuns,
  discoveredApps,
  jobFailures,
  releases,
  sources,
} from "@versioneer/db";

import {
  loadAppsByIds,
  loadEntityRefsByIds,
  loadSourcesByIds,
  toAppSummary,
} from "./entity-summaries";
import {
  atRiskSourceCondition,
  buildAtRiskSources,
  staleSourceCondition,
} from "./homepage-helpers";
import { openOperationalJobFailureCondition } from "./job-failure-filters";
import { authMiddleware } from "./middleware";

export const getHomepage = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async () => {
    const db = createDb(env.DB);
    const recentReleaseThreshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const openOperationalFailureCondition = openOperationalJobFailureCondition();

    const [
      [appCount],
      [publicCount],
      [recentReleaseCount],
      [activeSourceCount],
      [errorSourceCount],
      [staleSourceCount],
      [pendingFeedbackCount],
      [pendingDiscoveredCount],
      [pendingSuggestionCount],
      [openFailureCount],
      enrichmentHealthRows,
      suggestionRows,
      discoveryRows,
      feedbackRows,
      failureRows,
      atRiskRows,
      recentRunRows,
      recentReleaseRows,
    ] = await Promise.all([
      db.select({ count: sql<number>`count(*)` }).from(apps),
      db
        .select({ count: sql<number>`count(*)` })
        .from(apps)
        .where(eq(apps.status, "public")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(releases)
        .where(gt(releases.createdAt, recentReleaseThreshold)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(sources)
        .where(eq(sources.status, "active")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(sources)
        .where(eq(sources.status, "error")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(sources)
        .where(staleSourceCondition),
      db
        .select({ count: sql<number>`count(*)` })
        .from(clientFeedback)
        .where(eq(clientFeedback.status, "new")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(discoveredApps)
        .where(eq(discoveredApps.status, "pending")),
      db
        .select({ count: sql<number>`count(*)` })
        .from(catalogSuggestions)
        .where(inArray(catalogSuggestions.status, attentionCatalogSuggestionStatuses)),
      db
        .select({ count: sql<number>`count(*)` })
        .from(jobFailures)
        .where(openOperationalFailureCondition),
      db
        .select({
          status: discoveredApps.enrichmentStatus,
          count: sql<number>`count(*)`,
        })
        .from(discoveredApps)
        .where(sql`${discoveredApps.status} IN ('pending','linked')`)
        .groupBy(discoveredApps.enrichmentStatus),
      db
        .select()
        .from(catalogSuggestions)
        .where(inArray(catalogSuggestions.status, attentionCatalogSuggestionStatuses))
        .orderBy(
          sql`case when ${catalogSuggestions.status} = 'failed' then 0 else 1 end`,
          asc(catalogSuggestions.firstSeenAt),
          asc(catalogSuggestions.createdAt),
        )
        .limit(5),
      db
        .select()
        .from(discoveredApps)
        .where(eq(discoveredApps.status, "pending"))
        .orderBy(desc(discoveredApps.confidenceScore), desc(discoveredApps.sightingCount))
        .limit(5),
      db
        .select()
        .from(clientFeedback)
        .where(eq(clientFeedback.status, "new"))
        .orderBy(desc(clientFeedback.createdAt))
        .limit(5),
      db
        .select()
        .from(jobFailures)
        .where(openOperationalFailureCondition)
        .orderBy(desc(jobFailures.createdAt))
        .limit(5),
      db.select().from(sources).where(atRiskSourceCondition),
      db.select().from(cronJobRuns).orderBy(desc(cronJobRuns.startedAt)).limit(5),
      db
        .select()
        .from(releases)
        .where(eq(releases.status, "active"))
        .orderBy(desc(releases.createdAt))
        .limit(5),
    ]);

    const [suggestionAppMap, suggestionSourceMap, feedbackAppMap, releaseAppMap, failureRefMap] =
      await Promise.all([
        loadAppsByIds(
          db,
          suggestionRows.map((item) => item.appId),
        ),
        loadSourcesByIds(
          db,
          suggestionRows.map((item) => item.sourceId),
        ),
        loadAppsByIds(
          db,
          feedbackRows.map((item) => item.targetAppId),
        ),
        loadAppsByIds(
          db,
          recentReleaseRows.map((item) => item.appId),
        ),
        loadEntityRefsByIds(
          db,
          failureRows.map((item) => item.relatedId),
        ),
      ]);

    const sourceAppMap = await loadAppsByIds(
      db,
      [...suggestionSourceMap.values()].map((source) => source.appId),
    );
    const atRiskAppRows = await loadAppsByIds(
      db,
      atRiskRows.map((item) => item.appId),
    );
    const atRiskApps = new Map(
      [...atRiskAppRows.entries()].map(([id, row]) => [id, toAppSummary(row)]),
    );

    const latestRows =
      recentReleaseRows.length > 0
        ? await db
            .select()
            .from(appLatestReleases)
            .where(
              inArray(
                appLatestReleases.releaseId,
                recentReleaseRows.map((item) => item.id),
              ),
            )
            .all()
        : [];
    const latestTargetsByRelease = new Map<string, string[]>();
    const pinnedTargetsByRelease = new Map<string, string[]>();
    for (const row of latestRows) {
      latestTargetsByRelease.set(row.releaseId, [
        ...(latestTargetsByRelease.get(row.releaseId) ?? []),
        row.targetArchitecture,
      ]);
      if (row.pinnedReleaseId) {
        pinnedTargetsByRelease.set(row.pinnedReleaseId, [
          ...(pinnedTargetsByRelease.get(row.pinnedReleaseId) ?? []),
          row.targetArchitecture,
        ]);
      }
    }

    const pendingSuggestions = suggestionRows.map((item) => {
      const source = item.sourceId ? (suggestionSourceMap.get(item.sourceId) ?? null) : null;

      return Object.assign({}, item, {
        app: item.appId
          ? suggestionAppMap.get(item.appId)
            ? toAppSummary(suggestionAppMap.get(item.appId)!)
            : null
          : null,
        source: source
          ? {
              id: source.id,
              sourceType: source.sourceType,
              label: source.label,
              parserKey: source.parserKey,
              channel: source.channel,
              reviewStatus: source.reviewStatus,
              role: source.role,
              status: source.status,
              app: sourceAppMap.get(source.appId)
                ? toAppSummary(sourceAppMap.get(source.appId)!)
                : null,
            }
          : null,
      });
    });

    const pendingDiscoveries: HomepageDiscoveryItem[] = discoveryRows.map((item) => ({
      id: item.id,
      appName: item.appName,
      bundleId: item.bundleId,
      masAppId: item.masAppId,
      sightingCount: item.sightingCount,
      lastSeenAt: item.lastSeenAt,
      enrichmentStatus: item.enrichmentStatus,
      sourceValidationStatus: item.sourceValidationStatus,
      confidenceScore: item.confidenceScore,
      enrichedLatestVersion: item.enrichedLatestVersion,
      enrichedVendorName: item.enrichedVendorName,
      iconR2Key: item.iconR2Key,
      sparkleFeedUrl: item.sparkleFeedUrl,
      electronUpdateUrl: item.electronUpdateUrl,
      electronUpdateProvider: item.electronUpdateProvider,
      minMacOSVersion: item.minMacOSVersion,
      homebrewCaskToken: item.homebrewCaskToken,
      homebrewCaskVersion: item.homebrewCaskVersion,
    }));

    const newFeedback: FeedbackListItem[] = feedbackRows.map((item) =>
      Object.assign({}, item, {
        targetApp:
          item.targetAppId && feedbackAppMap.get(item.targetAppId)
            ? toAppSummary(feedbackAppMap.get(item.targetAppId)!)
            : null,
      }),
    );

    const openFailures: JobFailureListItem[] = failureRows.map((item) =>
      Object.assign({}, item, {
        relatedRef: item.relatedId ? (failureRefMap.get(item.relatedId) ?? null) : null,
      }),
    );

    const atRiskSources = buildAtRiskSources(atRiskRows, atRiskApps);

    const recentRuns: HomepageRunItem[] = recentRunRows.map((item) => ({
      id: item.id,
      jobType: item.jobType,
      trigger: item.trigger,
      status: item.status,
      actorId: item.actorId,
      itemsQueued: item.itemsQueued,
      itemsTotal: item.itemsTotal,
      errorMessage: item.errorMessage,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
    }));

    const recentReleases: ReleaseListItem[] = recentReleaseRows.map((item) =>
      Object.assign({}, item, {
        app: releaseAppMap.get(item.appId) ? toAppSummary(releaseAppMap.get(item.appId)!) : null,
        isLatestForChannel: latestTargetsByRelease.has(item.id),
        isPinnedLatest: pinnedTargetsByRelease.has(item.id),
        latestTargetArchitectures: latestTargetsByRelease.get(item.id) ?? [],
        pinnedTargetArchitectures: pinnedTargetsByRelease.get(item.id) ?? [],
      }),
    );

    const enrichByStatus = Object.fromEntries(
      enrichmentHealthRows.map((row) => [row.status, row.count]),
    );

    return {
      overview: {
        needsAttention: {
          pendingCatalogSuggestions: pendingSuggestionCount?.count ?? 0,
          pendingDiscoveredApps: pendingDiscoveredCount?.count ?? 0,
          pendingFeedback: pendingFeedbackCount?.count ?? 0,
          openFailures: openFailureCount?.count ?? 0,
        },
        sourceHealth: {
          activeSources: activeSourceCount?.count ?? 0,
          errorSources: errorSourceCount?.count ?? 0,
          staleSources: staleSourceCount?.count ?? 0,
        },
        catalogContext: {
          publicApps: publicCount?.count ?? 0,
          totalApps: appCount?.count ?? 0,
          recentReleases: recentReleaseCount?.count ?? 0,
        },
        enrichmentHealth: {
          pendingEnrichment: enrichByStatus.pending ?? 0,
          enriched: enrichByStatus.success ?? 0,
          failed: enrichByStatus.failed ?? 0,
          inProgress: enrichByStatus.in_progress ?? 0,
        },
      },
      pendingSuggestions,
      pendingDiscoveries,
      newFeedback,
      openFailures,
      atRiskSources,
      recentRuns,
      recentReleases,
    } satisfies DashboardHomepageData;
  });
