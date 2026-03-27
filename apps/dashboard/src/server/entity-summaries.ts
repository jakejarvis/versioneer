import { createDb } from "@versioneer/db";
import {
  apps,
  releases,
  sources,
  adminOverrides,
  reviewQueue,
  jobFailures,
  clientFeedback,
} from "@versioneer/schema";
import { inArray } from "drizzle-orm";

import type { AppSummary, LinkedEntityRef, ReleaseSummary, SourceSummary } from "@/api/types";

type Database = ReturnType<typeof createDb>;
type AppRow = typeof apps.$inferSelect;
type SourceRow = typeof sources.$inferSelect;
type ReleaseRow = typeof releases.$inferSelect;

export function toAppSummary(app: AppRow): AppSummary {
  return {
    id: app.id,
    slug: app.slug,
    canonicalName: app.canonicalName,
    vendorName: app.vendorName,
    iconR2Key: app.iconR2Key,
    status: app.status,
  };
}

export function toSourceSummary(source: SourceRow, app: AppRow | null): SourceSummary {
  return {
    id: source.id,
    sourceType: source.sourceType,
    label: source.label,
    parserKey: source.parserKey,
    status: source.status,
    app: app ? toAppSummary(app) : null,
  };
}

export function toReleaseSummary(release: ReleaseRow, app: AppRow | null): ReleaseSummary {
  return {
    id: release.id,
    versionRaw: release.versionRaw,
    channel: release.channel,
    status: release.status,
    isPrerelease: release.isPrerelease,
    releasedAt: release.releasedAt,
    app: app ? toAppSummary(app) : null,
  };
}

function unique(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export async function loadAppsByIds(db: Database, appIds: Array<string | null | undefined>) {
  const ids = unique(appIds);
  if (ids.length === 0) {
    return new Map<string, AppRow>();
  }

  const rows = await db.select().from(apps).where(inArray(apps.id, ids)).all();
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadSourcesByIds(db: Database, sourceIds: Array<string | null | undefined>) {
  const ids = unique(sourceIds);
  if (ids.length === 0) {
    return new Map<string, SourceRow>();
  }

  const rows = await db.select().from(sources).where(inArray(sources.id, ids)).all();
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadReleasesByIds(
  db: Database,
  releaseIds: Array<string | null | undefined>,
) {
  const ids = unique(releaseIds);
  if (ids.length === 0) {
    return new Map<string, ReleaseRow>();
  }

  const rows = await db.select().from(releases).where(inArray(releases.id, ids)).all();
  return new Map(rows.map((row) => [row.id, row]));
}

export async function loadEntityRefsByIds(
  db: Database,
  ids: Array<string | null | undefined>,
): Promise<Map<string, LinkedEntityRef>> {
  const appIds = unique(ids.filter((id) => id?.startsWith("app_")));
  const sourceIds = unique(ids.filter((id) => id?.startsWith("src_")));
  const releaseIds = unique(ids.filter((id) => id?.startsWith("rel_")));
  const overrideIds = unique(ids.filter((id) => id?.startsWith("ovr_")));
  const reviewIds = unique(ids.filter((id) => id?.startsWith("rq_")));
  const failureIds = unique(ids.filter((id) => id?.startsWith("jf_")));
  const feedbackIds = unique(ids.filter((id) => id?.startsWith("fb_")));

  const [appMap, sourceMap, releaseMap] = await Promise.all([
    loadAppsByIds(db, appIds),
    loadSourcesByIds(db, sourceIds),
    loadReleasesByIds(db, releaseIds),
  ]);
  const sourceAppMap = await loadAppsByIds(
    db,
    [...sourceMap.values()].map((source) => source.appId),
  );
  const releaseAppMap = await loadAppsByIds(
    db,
    [...releaseMap.values()].map((release) => release.appId),
  );
  const [overrideRows, reviewRows, failureRows, feedbackRows] = await Promise.all([
    overrideIds.length > 0
      ? db.select().from(adminOverrides).where(inArray(adminOverrides.id, overrideIds)).all()
      : Promise.resolve([]),
    reviewIds.length > 0
      ? db.select().from(reviewQueue).where(inArray(reviewQueue.id, reviewIds)).all()
      : Promise.resolve([]),
    failureIds.length > 0
      ? db.select().from(jobFailures).where(inArray(jobFailures.id, failureIds)).all()
      : Promise.resolve([]),
    feedbackIds.length > 0
      ? db.select().from(clientFeedback).where(inArray(clientFeedback.id, feedbackIds)).all()
      : Promise.resolve([]),
  ]);

  const map = new Map<string, LinkedEntityRef>();

  for (const app of appMap.values()) {
    map.set(app.id, {
      kind: "app",
      id: app.id,
      label: app.canonicalName,
      description: app.vendorName ?? app.slug,
      iconR2Key: app.iconR2Key,
    });
  }

  for (const source of sourceMap.values()) {
    const app = sourceAppMap.get(source.appId) ?? null;
    map.set(source.id, {
      kind: "source",
      id: source.id,
      label: source.label ?? source.sourceType,
      description: app ? app.canonicalName : source.parserKey,
      iconR2Key: app?.iconR2Key ?? null,
    });
  }

  for (const release of releaseMap.values()) {
    const app = releaseAppMap.get(release.appId) ?? null;
    map.set(release.id, {
      kind: "release",
      id: release.id,
      label: release.versionRaw,
      description: app ? app.canonicalName : release.channel,
      iconR2Key: app?.iconR2Key ?? null,
    });
  }

  for (const override of overrideRows) {
    map.set(override.id, {
      kind: "override",
      id: override.id,
      label: override.overrideType,
      description: override.reason ?? override.targetType,
      iconR2Key: null,
    });
  }

  for (const item of reviewRows) {
    map.set(item.id, {
      kind: "review_queue",
      id: item.id,
      label: item.reviewType,
      description: item.status,
      iconR2Key: null,
    });
  }

  for (const failure of failureRows) {
    map.set(failure.id, {
      kind: "job_failure",
      id: failure.id,
      label: failure.jobType,
      description: failure.status,
      iconR2Key: null,
    });
  }

  for (const feedback of feedbackRows) {
    map.set(feedback.id, {
      kind: "feedback",
      id: feedback.id,
      label: feedback.feedbackType,
      description: feedback.appName ?? feedback.bundleId ?? feedback.status,
      iconR2Key: null,
    });
  }

  return map;
}

export async function resolveTargetRefs(
  db: Database,
  targets: Array<{ targetType: string | null; targetId: string | null }>,
) {
  const directIds = targets
    .map(({ targetId, targetType }) => {
      if (!targetId || !targetType) {
        return null;
      }

      if (targetType === "app" || targetType === "source" || targetType === "release") {
        return targetId;
      }

      if (targetType === "override" || targetType === "review_queue" || targetType === "feedback") {
        return targetId;
      }

      if (targetType === "app_latest") {
        return targetId.split(":")[0] ?? null;
      }

      return null;
    })
    .filter((value): value is string => Boolean(value));

  const refMap = await loadEntityRefsByIds(db, directIds);

  return new Map(
    targets.map(({ targetType, targetId }) => {
      if (!targetType || !targetId) {
        return [`${targetType}:${targetId}`, null] as const;
      }

      if (targetType === "app_latest") {
        const [appId, channel] = targetId.split(":");
        const appRef = appId ? refMap.get(appId) : null;

        return [
          `${targetType}:${targetId}`,
          appRef
            ? {
                ...appRef,
                description: `${channel ?? "unknown"} latest`,
              }
            : null,
        ] as const;
      }

      return [`${targetType}:${targetId}`, refMap.get(targetId) ?? null] as const;
    }),
  );
}

export async function resolveSourceSummaries(
  db: Database,
  rows: SourceRow[],
): Promise<Map<string, SourceSummary>> {
  const appMap = await loadAppsByIds(
    db,
    rows.map((row) => row.appId),
  );

  return new Map(rows.map((row) => [row.id, toSourceSummary(row, appMap.get(row.appId) ?? null)]));
}

export async function resolveReleaseSummaries(
  db: Database,
  rows: ReleaseRow[],
): Promise<Map<string, ReleaseSummary>> {
  const appMap = await loadAppsByIds(
    db,
    rows.map((row) => row.appId),
  );

  return new Map(rows.map((row) => [row.id, toReleaseSummary(row, appMap.get(row.appId) ?? null)]));
}
