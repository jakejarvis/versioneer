import { asc, desc } from "drizzle-orm";

import {
  apps,
  catalogSuggestions,
  discoveredApps,
  releases,
  sourceFetches,
  sources,
} from "@versioneer/db";

export type SortDirection = "asc" | "desc";

export function appOrderBy(sortBy?: string, sortDir?: SortDirection) {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "canonicalName":
      return [direction(apps.canonicalName)];
    case "slug":
      return [direction(apps.slug)];
    case "vendorName":
      return [direction(apps.vendorName)];
    case "status":
      return [direction(apps.status)];
    case "updatedAt":
    default:
      return [desc(apps.updatedAt)];
  }
}

export function appReleaseOrderBy(sortBy?: string, sortDir?: SortDirection) {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "versionRaw":
      return [direction(releases.versionNormalized), direction(releases.versionRaw)];
    case "channel":
      return [direction(releases.channel), desc(releases.createdAt)];
    case "status":
      return [direction(releases.status), desc(releases.createdAt)];
    case "releasedAt":
      return [direction(releases.releasedAt), desc(releases.createdAt)];
    case "createdAt":
    default:
      return [desc(releases.createdAt)];
  }
}

export function releaseOrderBy(sortBy?: string, sortDir?: SortDirection) {
  return appReleaseOrderBy(sortBy, sortDir);
}

export function sourceOrderBy(sortBy?: string, sortDir?: SortDirection) {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "label":
      return [direction(sources.label), desc(sources.updatedAt)];
    case "sourceType":
      return [direction(sources.sourceType), desc(sources.updatedAt)];
    case "parserKey":
      return [direction(sources.parserKey), desc(sources.updatedAt)];
    case "channel":
      return [direction(sources.channel), desc(sources.updatedAt)];
    case "status":
      return [direction(sources.status), desc(sources.updatedAt)];
    case "pollIntervalMinutes":
      return [direction(sources.pollIntervalMinutes), desc(sources.updatedAt)];
    case "lastFetchedAt":
      return [direction(sources.lastFetchedAt), desc(sources.updatedAt)];
    case "lastSuccessAt":
      return [direction(sources.lastSuccessAt), desc(sources.updatedAt)];
    case "updatedAt":
    default:
      return [desc(sources.updatedAt)];
  }
}

export function sourceFetchOrderBy(sortBy?: string, sortDir?: SortDirection) {
  const direction = sortDir === "asc" ? asc : desc;

  switch (sortBy) {
    case "fetchStatus":
      return [direction(sourceFetches.fetchStatus), desc(sourceFetches.fetchedAt)];
    case "httpStatus":
      return [direction(sourceFetches.httpStatus), desc(sourceFetches.fetchedAt)];
    case "fetchedAt":
    default:
      return [desc(sourceFetches.fetchedAt)];
  }
}

export function discoveredAppOrderBy(sortBy?: string, sortDir?: SortDirection) {
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

export function catalogSuggestionOrderBy(sortBy?: string, sortDir?: SortDirection) {
  const direction = sortDir === "desc" ? desc : asc;
  const sortColumns = {
    firstSeenAt: catalogSuggestions.firstSeenAt,
    lastSeenAt: catalogSuggestions.lastSeenAt,
    evidenceCount: catalogSuggestions.evidenceCount,
    createdAt: catalogSuggestions.createdAt,
  } as const;
  const sortCol = sortBy ? sortColumns[sortBy as keyof typeof sortColumns] : null;

  return sortCol
    ? [direction(sortCol), asc(catalogSuggestions.createdAt)]
    : [asc(catalogSuggestions.firstSeenAt), asc(catalogSuggestions.createdAt)];
}
