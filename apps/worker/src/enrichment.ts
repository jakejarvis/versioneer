import { and, desc, notInArray, sql } from "drizzle-orm";

import { enrichDiscoveredApp } from "@versioneer/core/pipeline";
import { createDb, discoveredApps } from "@versioneer/db";

export const ENRICHMENT_BATCH_SIZE = 25;

type Db = ReturnType<typeof createDb>;

export interface EnrichmentBatchResult {
  candidateCount: number;
  attemptedIds: string[];
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ discoveredAppId: string; errorMessage: string }>;
}

export async function listEnrichmentCandidates(
  db: Db,
  limit = ENRICHMENT_BATCH_SIZE,
  excludeIds: string[] = [],
) {
  const conditions = [
    sql`(${discoveredApps.status} = 'pending' OR ${discoveredApps.status} = 'linked')
      AND (
        ${discoveredApps.enrichmentStatus} IN ('pending', 'failed')
        OR (${discoveredApps.enrichmentStatus} = 'in_progress'
            AND datetime(${discoveredApps.updatedAt}, '+15 minutes') <= datetime('now'))
        OR (${discoveredApps.enrichmentStatus} = 'success'
            AND datetime(${discoveredApps.enrichedAt}, '+24 hours') <= datetime('now'))
      )`,
  ];
  if (excludeIds.length > 0) {
    conditions.push(notInArray(discoveredApps.id, excludeIds));
  }

  return db
    .select({ id: discoveredApps.id })
    .from(discoveredApps)
    .where(and(...conditions))
    .orderBy(
      sql`CASE ${discoveredApps.enrichmentStatus}
        WHEN 'pending' THEN 0
        WHEN 'failed' THEN 1
        WHEN 'in_progress' THEN 2
        ELSE 3
      END`,
      sql`COALESCE(${discoveredApps.enrichedAt}, '1970-01-01') ASC`,
      desc(discoveredApps.lastSeenAt),
    )
    .limit(limit)
    .all();
}

export async function runEnrichmentBatch(params: {
  db: Db;
  env: Pick<Env, "GITHUB_TOKEN" | "RAW_BUCKET" | "CONFIG_KV">;
  limit?: number;
  excludeIds?: string[];
}): Promise<EnrichmentBatchResult> {
  const candidates = await listEnrichmentCandidates(params.db, params.limit, params.excludeIds);
  const result: EnrichmentBatchResult = {
    candidateCount: candidates.length,
    attemptedIds: [],
    attempted: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  for (const candidate of candidates) {
    result.attempted++;
    result.attemptedIds.push(candidate.id);
    const enrichment = await enrichDiscoveredApp({
      discoveredAppId: candidate.id,
      db: params.db,
      githubToken: params.env.GITHUB_TOKEN,
      assetsBucket: params.env.RAW_BUCKET,
      configKv: params.env.CONFIG_KV,
    });

    if (enrichment.enrichmentStatus === "failed") {
      result.failed++;
      result.errors.push({
        discoveredAppId: candidate.id,
        errorMessage: enrichment.enrichmentError ?? "Enrichment failed",
      });
    } else {
      result.succeeded++;
    }
  }

  return result;
}
