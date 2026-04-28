import { and, desc, eq, isNull, lte } from "drizzle-orm";

import { createLogger } from "@versioneer/core/logger";
import { enrichDiscoveredApp } from "@versioneer/core/pipeline";
import { createDb, discoveredApps } from "@versioneer/db";

export const ENRICHMENT_BATCH_SIZE = 25;
const ENRICHMENT_RETRY_DELAY_MS = 15 * 60 * 1000;
const ENRICHMENT_REFRESH_DELAY_MS = 24 * 60 * 60 * 1000;
const ENRICHMENT_CANDIDATE_STATUSES = ["pending", "linked"] as const;

type Db = ReturnType<typeof createDb>;
type Logger = ReturnType<typeof createLogger>;
type EnrichmentCandidateRow = {
  id: string;
  updatedAt: string;
  lastSeenAt: string;
  enrichmentStartedAt: string | null;
  enrichedAt: string | null;
};

const enrichmentCandidateSelection = {
  id: discoveredApps.id,
  updatedAt: discoveredApps.updatedAt,
  lastSeenAt: discoveredApps.lastSeenAt,
  enrichmentStartedAt: discoveredApps.enrichmentStartedAt,
  enrichedAt: discoveredApps.enrichedAt,
} as const;

export interface EnrichmentBatchResult {
  candidateCount: number;
  attemptedIds: string[];
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ discoveredAppId: string; errorMessage: string }>;
}

function subtractMsFromIso(value: string, ms: number): string {
  return new Date(new Date(value).getTime() - ms).toISOString();
}

function compareLastSeenDesc(a: EnrichmentCandidateRow, b: EnrichmentCandidateRow): number {
  return b.lastSeenAt.localeCompare(a.lastSeenAt);
}

function compareRetryCandidates(
  a: EnrichmentCandidateRow,
  b: EnrichmentCandidateRow,
  key: "updatedAt" | "enrichmentStartedAt",
): number {
  const aTime =
    key === "enrichmentStartedAt" ? (a.enrichmentStartedAt ?? a.updatedAt) : a.updatedAt;
  const bTime =
    key === "enrichmentStartedAt" ? (b.enrichmentStartedAt ?? b.updatedAt) : b.updatedAt;
  if (aTime !== bTime) {
    return aTime.localeCompare(bTime);
  }
  return compareLastSeenDesc(a, b);
}

function compareStaleSuccessCandidates(
  a: EnrichmentCandidateRow,
  b: EnrichmentCandidateRow,
): number {
  const aTime = a.enrichedAt ?? a.updatedAt;
  const bTime = b.enrichedAt ?? b.updatedAt;
  if (aTime !== bTime) {
    return aTime.localeCompare(bTime);
  }
  return compareLastSeenDesc(a, b);
}

async function selectPendingCandidatesByStatus(
  db: Db,
  status: (typeof ENRICHMENT_CANDIDATE_STATUSES)[number],
  limit: number,
): Promise<EnrichmentCandidateRow[]> {
  return db
    .select(enrichmentCandidateSelection)
    .from(discoveredApps)
    .where(and(eq(discoveredApps.status, status), eq(discoveredApps.enrichmentStatus, "pending")))
    .orderBy(desc(discoveredApps.lastSeenAt))
    .limit(limit)
    .all();
}

async function selectFailedCandidatesByStatus(
  db: Db,
  status: (typeof ENRICHMENT_CANDIDATE_STATUSES)[number],
  limit: number,
  retryBefore: string,
): Promise<EnrichmentCandidateRow[]> {
  return db
    .select(enrichmentCandidateSelection)
    .from(discoveredApps)
    .where(
      and(
        eq(discoveredApps.status, status),
        eq(discoveredApps.enrichmentStatus, "failed"),
        lte(discoveredApps.updatedAt, retryBefore),
      ),
    )
    .orderBy(discoveredApps.updatedAt)
    .limit(limit)
    .all();
}

async function selectInProgressCandidatesByStatus(
  db: Db,
  status: (typeof ENRICHMENT_CANDIDATE_STATUSES)[number],
  limit: number,
  retryBefore: string,
): Promise<EnrichmentCandidateRow[]> {
  const [startedRows, fallbackRows] = await Promise.all([
    db
      .select(enrichmentCandidateSelection)
      .from(discoveredApps)
      .where(
        and(
          eq(discoveredApps.status, status),
          eq(discoveredApps.enrichmentStatus, "in_progress"),
          lte(discoveredApps.enrichmentStartedAt, retryBefore),
        ),
      )
      .orderBy(discoveredApps.enrichmentStartedAt)
      .limit(limit)
      .all(),
    db
      .select(enrichmentCandidateSelection)
      .from(discoveredApps)
      .where(
        and(
          eq(discoveredApps.status, status),
          eq(discoveredApps.enrichmentStatus, "in_progress"),
          isNull(discoveredApps.enrichmentStartedAt),
          lte(discoveredApps.updatedAt, retryBefore),
        ),
      )
      .orderBy(discoveredApps.updatedAt)
      .limit(limit)
      .all(),
  ]);

  return [...startedRows, ...fallbackRows]
    .sort((a, b) => compareRetryCandidates(a, b, "enrichmentStartedAt"))
    .slice(0, limit);
}

async function selectStaleSuccessCandidatesByStatus(
  db: Db,
  status: (typeof ENRICHMENT_CANDIDATE_STATUSES)[number],
  limit: number,
  refreshBefore: string,
): Promise<EnrichmentCandidateRow[]> {
  return db
    .select(enrichmentCandidateSelection)
    .from(discoveredApps)
    .where(
      and(
        eq(discoveredApps.status, status),
        eq(discoveredApps.enrichmentStatus, "success"),
        lte(discoveredApps.enrichedAt, refreshBefore),
      ),
    )
    .orderBy(discoveredApps.enrichedAt)
    .limit(limit)
    .all();
}

async function selectBucketCandidates(
  loader: (
    status: (typeof ENRICHMENT_CANDIDATE_STATUSES)[number],
  ) => Promise<EnrichmentCandidateRow[]>,
  comparator: (a: EnrichmentCandidateRow, b: EnrichmentCandidateRow) => number,
  limit: number,
): Promise<EnrichmentCandidateRow[]> {
  const rows = (
    await Promise.all(ENRICHMENT_CANDIDATE_STATUSES.map((status) => loader(status)))
  ).flat();
  return rows.sort(comparator).slice(0, limit);
}

export async function listEnrichmentCandidates(
  db: Db,
  limit = ENRICHMENT_BATCH_SIZE,
  now = new Date().toISOString(),
) {
  if (limit <= 0) {
    return [];
  }

  const retryBefore = subtractMsFromIso(now, ENRICHMENT_RETRY_DELAY_MS);
  const refreshBefore = subtractMsFromIso(now, ENRICHMENT_REFRESH_DELAY_MS);
  const selected: EnrichmentCandidateRow[] = [];

  const pendingRows = await selectBucketCandidates(
    (status) => selectPendingCandidatesByStatus(db, status, limit),
    compareLastSeenDesc,
    limit,
  );
  selected.push(...pendingRows.slice(0, limit));

  let remaining = limit - selected.length;
  if (remaining > 0) {
    const failedRows = await selectBucketCandidates(
      (status) => selectFailedCandidatesByStatus(db, status, remaining, retryBefore),
      (a, b) => compareRetryCandidates(a, b, "updatedAt"),
      remaining,
    );
    selected.push(...failedRows.slice(0, remaining));
    remaining = limit - selected.length;
  }

  if (remaining > 0) {
    const inProgressRows = await selectBucketCandidates(
      (status) => selectInProgressCandidatesByStatus(db, status, remaining, retryBefore),
      (a, b) => compareRetryCandidates(a, b, "enrichmentStartedAt"),
      remaining,
    );
    selected.push(...inProgressRows.slice(0, remaining));
    remaining = limit - selected.length;
  }

  if (remaining > 0) {
    const successRows = await selectBucketCandidates(
      (status) => selectStaleSuccessCandidatesByStatus(db, status, remaining, refreshBefore),
      compareStaleSuccessCandidates,
      remaining,
    );
    selected.push(...successRows.slice(0, remaining));
  }

  return selected.map(({ id }) => ({ id }));
}

export async function runEnrichmentBatch(params: {
  db: Db;
  env: Pick<Env, "GITHUB_TOKEN" | "ASSETS_BUCKET" | "CONFIG_KV">;
  limit?: number;
  log?: Logger;
}): Promise<EnrichmentBatchResult> {
  const candidates = await listEnrichmentCandidates(params.db, params.limit);
  const log = params.log ?? createLogger({ component: "enrichment_batch" });
  log.info("enrichment candidates selected", {
    candidateCount: candidates.length,
    limit: params.limit ?? ENRICHMENT_BATCH_SIZE,
  });
  const result: EnrichmentBatchResult = {
    candidateCount: candidates.length,
    attemptedIds: [],
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  for (const candidate of candidates) {
    const startedAtMs = Date.now();
    result.attempted++;
    result.attemptedIds.push(candidate.id);
    log.info("enrichment candidate started", { discoveredAppId: candidate.id });
    let enrichment;
    try {
      enrichment = await enrichDiscoveredApp({
        discoveredAppId: candidate.id,
        db: params.db,
        githubToken: params.env.GITHUB_TOKEN,
        assetsBucket: params.env.ASSETS_BUCKET,
        configKv: params.env.CONFIG_KV,
      });
    } catch (error) {
      log.error("enrichment candidate threw", {
        discoveredAppId: candidate.id,
        durationMs: Date.now() - startedAtMs,
        error,
      });
      throw error;
    }

    if (enrichment.enrichmentStatus === "failed") {
      result.failed++;
      const errorEntry = {
        discoveredAppId: candidate.id,
        errorMessage: enrichment.enrichmentError ?? "Enrichment failed",
      };
      result.errors.push(errorEntry);
      log.warn("enrichment candidate failed", {
        ...errorEntry,
        durationMs: Date.now() - startedAtMs,
      });
    } else {
      result.succeeded++;
      log.info("enrichment candidate succeeded", {
        discoveredAppId: candidate.id,
        durationMs: Date.now() - startedAtMs,
      });
    }
  }

  log.info("enrichment batch result", {
    candidates: result.candidateCount,
    attempted: result.attempted,
    succeeded: result.succeeded,
    failed: result.failed,
  });
  return result;
}
