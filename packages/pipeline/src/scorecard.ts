import { createDb } from "@versioneer/db";
import {
  apps,
  sources,
  sourceFetches,
  parserRuns,
  appLatestReleases,
  artifacts,
  clientInventoryApps,
  adminOverrides,
  appScorecards,
  onboardingChecklists,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { eq, and, desc, sql } from "drizzle-orm";

import type { Env } from "./types";
import { autoPromoteVerification } from "./verification";

export interface ScorecardData {
  sourceTypesPresent: string[];
  latestFetchSuccessAt: string | null;
  recentFetchSuccessRate: number | null;
  recentParseSuccessRate: number | null;
  latestReleaseConfidence: number | null;
  artifactTrustStatus: string | null;
  inventoryMatchSuccessRate: number | null;
  ambiguityRate: number | null;
  activeOverrideCount: number;
}

export type QualityState = "green" | "yellow" | "red" | "unknown";

const FETCH_SAMPLE_SIZE = 20;
const PARSE_SAMPLE_SIZE = 20;
const INVENTORY_SAMPLE_SIZE = 100;

export async function computeScorecard(
  db: ReturnType<typeof createDb>,
  appId: string,
): Promise<ScorecardData> {
  // Source types present
  const appSources = await db
    .select({ sourceType: sources.sourceType })
    .from(sources)
    .where(and(eq(sources.appId, appId), eq(sources.status, "active")))
    .all();
  const sourceTypesPresent = [...new Set(appSources.map((s) => s.sourceType))];

  // Source IDs for this app
  const sourceIds = await db
    .select({ id: sources.id })
    .from(sources)
    .where(eq(sources.appId, appId))
    .all();
  const sourceIdSet = sourceIds.map((s) => s.id);

  // Recent fetch success rate
  let latestFetchSuccessAt: string | null = null;
  let recentFetchSuccessRate: number | null = null;

  if (sourceIdSet.length > 0) {
    const recentFetches = await db
      .select({ fetchStatus: sourceFetches.fetchStatus, fetchedAt: sourceFetches.fetchedAt })
      .from(sourceFetches)
      .innerJoin(sources, eq(sourceFetches.sourceId, sources.id))
      .where(eq(sources.appId, appId))
      .orderBy(desc(sourceFetches.fetchedAt))
      .limit(FETCH_SAMPLE_SIZE)
      .all();

    if (recentFetches.length > 0) {
      const successCount = recentFetches.filter(
        (f) => f.fetchStatus === "success" || f.fetchStatus === "not_modified",
      ).length;
      recentFetchSuccessRate = Math.round((successCount / recentFetches.length) * 100);

      const latestSuccess = recentFetches.find(
        (f) => f.fetchStatus === "success" || f.fetchStatus === "not_modified",
      );
      latestFetchSuccessAt = latestSuccess?.fetchedAt ?? null;
    }
  }

  // Recent parse success rate
  let recentParseSuccessRate: number | null = null;
  if (sourceIdSet.length > 0) {
    const recentParses = await db
      .select({ runStatus: parserRuns.runStatus })
      .from(parserRuns)
      .innerJoin(sourceFetches, eq(parserRuns.sourceFetchId, sourceFetches.id))
      .innerJoin(sources, eq(sourceFetches.sourceId, sources.id))
      .where(eq(sources.appId, appId))
      .orderBy(desc(parserRuns.startedAt))
      .limit(PARSE_SAMPLE_SIZE)
      .all();

    if (recentParses.length > 0) {
      const successCount = recentParses.filter(
        (p) => p.runStatus === "success" || p.runStatus === "partial",
      ).length;
      recentParseSuccessRate = Math.round((successCount / recentParses.length) * 100);
    }
  }

  // Latest release confidence
  const latestRelease = await db
    .select({ confidence: appLatestReleases.confidence })
    .from(appLatestReleases)
    .where(and(eq(appLatestReleases.appId, appId), eq(appLatestReleases.channel, "stable")))
    .get();
  const latestReleaseConfidence = latestRelease?.confidence ?? null;

  // Artifact trust status
  let artifactTrustStatus: string | null = null;
  if (latestRelease) {
    const latestRel = await db
      .select({ releaseId: appLatestReleases.releaseId })
      .from(appLatestReleases)
      .where(and(eq(appLatestReleases.appId, appId), eq(appLatestReleases.channel, "stable")))
      .get();

    if (latestRel) {
      const primaryArt = await db
        .select({ signatureStatus: artifacts.signatureStatus })
        .from(artifacts)
        .where(and(eq(artifacts.releaseId, latestRel.releaseId), eq(artifacts.isPrimary, true)))
        .get();
      artifactTrustStatus = primaryArt?.signatureStatus ?? "unknown";
    }
  }

  // Inventory match success rate and ambiguity rate
  let inventoryMatchSuccessRate: number | null = null;
  let ambiguityRate: number | null = null;

  const recentMatches = await db
    .select({
      matchConfidence: clientInventoryApps.matchConfidence,
      decisionStatus: clientInventoryApps.decisionStatus,
    })
    .from(clientInventoryApps)
    .where(eq(clientInventoryApps.matchedAppId, appId))
    .orderBy(desc(clientInventoryApps.createdAt))
    .limit(INVENTORY_SAMPLE_SIZE)
    .all();

  if (recentMatches.length > 0) {
    const goodMatches = recentMatches.filter(
      (m) => m.matchConfidence !== null && m.matchConfidence >= 80,
    ).length;
    inventoryMatchSuccessRate = Math.round((goodMatches / recentMatches.length) * 100);

    const ambiguousCount = recentMatches.filter((m) => m.decisionStatus === "ambiguous").length;
    ambiguityRate = Math.round((ambiguousCount / recentMatches.length) * 100);
  }

  // Active override count
  const overrides = await db
    .select({ count: sql<number>`count(*)` })
    .from(adminOverrides)
    .where(
      and(eq(adminOverrides.isActive, true), sql`${adminOverrides.targetId} LIKE ${appId + "%"}`),
    )
    .get();
  const activeOverrideCount = overrides?.count ?? 0;

  return {
    sourceTypesPresent,
    latestFetchSuccessAt,
    recentFetchSuccessRate,
    recentParseSuccessRate,
    latestReleaseConfidence,
    artifactTrustStatus,
    inventoryMatchSuccessRate,
    ambiguityRate,
    activeOverrideCount,
  };
}

export function classifyQualityState(scorecard: ScorecardData): QualityState {
  // Unknown: no sources at all
  if (scorecard.sourceTypesPresent.length === 0) {
    return "unknown";
  }

  // Unknown: not enough data to judge — if any critical metric is still null,
  // we don't have sufficient signal to classify. Treating null as 0 would
  // incorrectly mark newly onboarded apps as "red".
  if (
    scorecard.recentFetchSuccessRate === null ||
    scorecard.recentParseSuccessRate === null ||
    scorecard.latestReleaseConfidence === null
  ) {
    return "unknown";
  }

  const fetchRate = scorecard.recentFetchSuccessRate;
  const parseRate = scorecard.recentParseSuccessRate;
  const confidence = scorecard.latestReleaseConfidence;

  // Red: any critical metric below threshold
  if (fetchRate < 70 || parseRate < 70 || confidence < 60) {
    return "red";
  }

  // Green: all metrics strong
  if (fetchRate >= 90 && parseRate >= 90 && confidence >= 80) {
    return "green";
  }

  // Yellow: borderline
  return "yellow";
}

export function computeQualityScore(scorecard: ScorecardData): number | null {
  const weights = {
    fetchRate: 25,
    parseRate: 25,
    confidence: 20,
    matchRate: 15,
    ambiguity: 15,
  };

  let totalWeight = 0;
  let weightedSum = 0;

  if (scorecard.recentFetchSuccessRate !== null) {
    weightedSum += scorecard.recentFetchSuccessRate * weights.fetchRate;
    totalWeight += weights.fetchRate;
  }

  if (scorecard.recentParseSuccessRate !== null) {
    weightedSum += scorecard.recentParseSuccessRate * weights.parseRate;
    totalWeight += weights.parseRate;
  }

  if (scorecard.latestReleaseConfidence !== null) {
    weightedSum += scorecard.latestReleaseConfidence * weights.confidence;
    totalWeight += weights.confidence;
  }

  if (scorecard.inventoryMatchSuccessRate !== null) {
    weightedSum += scorecard.inventoryMatchSuccessRate * weights.matchRate;
    totalWeight += weights.matchRate;
  }

  if (scorecard.ambiguityRate !== null) {
    // Invert: 0% ambiguity = 100 score, 100% ambiguity = 0 score
    weightedSum += (100 - scorecard.ambiguityRate) * weights.ambiguity;
    totalWeight += weights.ambiguity;
  }

  if (totalWeight === 0) return null;
  return Math.round(weightedSum / totalWeight);
}

export async function handleComputeScorecard(appId: string, env: Env): Promise<void> {
  const db = createDb(env.DB);
  const now = new Date().toISOString();

  const scorecard = await computeScorecard(db, appId);
  const qualityState = classifyQualityState(scorecard);
  const qualityScore = computeQualityScore(scorecard);

  // Upsert scorecard
  const existing = await db
    .select()
    .from(appScorecards)
    .where(eq(appScorecards.appId, appId))
    .get();

  if (existing) {
    await db
      .update(appScorecards)
      .set({
        sourceTypesPresent: JSON.stringify(scorecard.sourceTypesPresent),
        latestFetchSuccessAt: scorecard.latestFetchSuccessAt,
        recentFetchSuccessRate: scorecard.recentFetchSuccessRate,
        recentParseSuccessRate: scorecard.recentParseSuccessRate,
        latestReleaseConfidence: scorecard.latestReleaseConfidence,
        artifactTrustStatus: scorecard.artifactTrustStatus,
        inventoryMatchSuccessRate: scorecard.inventoryMatchSuccessRate,
        ambiguityRate: scorecard.ambiguityRate,
        activeOverrideCount: scorecard.activeOverrideCount,
        updatedAt: now,
      })
      .where(eq(appScorecards.id, existing.id));
  } else {
    await db.insert(appScorecards).values({
      id: generateId(idPrefixes.appScorecard),
      appId,
      sourceTypesPresent: JSON.stringify(scorecard.sourceTypesPresent),
      latestFetchSuccessAt: scorecard.latestFetchSuccessAt,
      recentFetchSuccessRate: scorecard.recentFetchSuccessRate,
      recentParseSuccessRate: scorecard.recentParseSuccessRate,
      latestReleaseConfidence: scorecard.latestReleaseConfidence,
      artifactTrustStatus: scorecard.artifactTrustStatus,
      inventoryMatchSuccessRate: scorecard.inventoryMatchSuccessRate,
      ambiguityRate: scorecard.ambiguityRate,
      activeOverrideCount: scorecard.activeOverrideCount,
      updatedAt: now,
    });
  }

  // Update app's quality state and score
  await db
    .update(apps)
    .set({
      qualityState,
      qualityScore,
      updatedAt: now,
    })
    .where(eq(apps.id, appId));

  // Auto-mark qualityScoreAcceptable on the onboarding checklist when quality
  // reaches green or yellow (not red, not unknown).
  if (qualityState === "green" || qualityState === "yellow") {
    const checklist = await db
      .select()
      .from(onboardingChecklists)
      .where(eq(onboardingChecklists.appId, appId))
      .get();

    if (checklist && !checklist.qualityScoreAcceptable) {
      const updates: Record<string, unknown> = {
        qualityScoreAcceptable: true,
        updatedAt: now,
      };
      const merged = { ...checklist, qualityScoreAcceptable: true };
      const allComplete =
        merged.hasCanonicalRecord &&
        merged.hasAliases &&
        merged.hasSource &&
        merged.parserOutputVerified &&
        merged.latestReleasePublished &&
        merged.reviewQueueClear &&
        merged.qualityScoreAcceptable;
      if (allComplete) {
        updates.isComplete = true;
        updates.completedAt = now;
      }
      await db
        .update(onboardingChecklists)
        .set(updates)
        .where(eq(onboardingChecklists.id, checklist.id));
    }
  }

  // Attempt automatic verification tier promotion (unverified → provisional → verified).
  // This runs after every scorecard computation since we now have fresh pipeline data.
  await autoPromoteVerification(db, appId);
}
