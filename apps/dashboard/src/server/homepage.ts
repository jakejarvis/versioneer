import { createServerFn } from "@tanstack/react-start";
import { env } from "cloudflare:workers";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";

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

export const getHomepage = createServerFn({ method: "GET" }).handler(async () => {
  const db = createDb(env.DB);

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
      .where(sql`${releases.createdAt} > datetime('now', '-7 days')`),
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
      .where(eq(catalogSuggestions.status, "pending")),
    db
      .select({ count: sql<number>`count(*)` })
      .from(jobFailures)
      .where(eq(jobFailures.status, "open")),
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
      .where(eq(catalogSuggestions.status, "pending"))
      .orderBy(asc(catalogSuggestions.firstSeenAt), asc(catalogSuggestions.createdAt))
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
      .where(eq(jobFailures.status, "open"))
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
  const latestReleaseIds = new Set(latestRows.map((row) => row.releaseId));
  const pinnedReleaseIds = new Set(
    latestRows.filter((row) => row.pinnedReleaseId).map((row) => row.pinnedReleaseId as string),
  );

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
      isLatestForChannel: latestReleaseIds.has(item.id),
      isPinnedLatest: pinnedReleaseIds.has(item.id),
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
