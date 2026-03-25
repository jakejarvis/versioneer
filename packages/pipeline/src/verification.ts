import { createDb } from "@versioneer/db";
import {
  apps,
  appAliases,
  appLatestReleases,
  artifacts,
  sources,
  sourceFetches,
  parserRuns,
  reviewQueue,
  auditLog,
  generateId,
  idPrefixes,
} from "@versioneer/schema";
import { eq, and, desc, sql } from "drizzle-orm";

export interface VerificationRequirement {
  name: string;
  met: boolean;
  detail: string;
}

export interface VerificationCheckResult {
  eligible: boolean;
  requirements: VerificationRequirement[];
}

export async function checkVerificationRequirements(
  db: ReturnType<typeof createDb>,
  appId: string,
): Promise<VerificationCheckResult> {
  const requirements: VerificationRequirement[] = [];

  // 1. Stable bundle ID matching (exact alias with confidence >= 95)
  const bundleAliases = await db
    .select()
    .from(appAliases)
    .where(
      and(
        eq(appAliases.appId, appId),
        eq(appAliases.aliasType, "bundle_id"),
        eq(appAliases.isExact, true),
        eq(appAliases.isActive, true),
      ),
    )
    .all();

  const hasBundleAlias = bundleAliases.some((a) => a.confidenceWeight >= 95);
  requirements.push({
    name: "Stable bundle ID match",
    met: hasBundleAlias,
    detail: hasBundleAlias
      ? `${bundleAliases.length} exact bundle ID alias(es)`
      : "No exact bundle ID alias with confidence >= 95",
  });

  // 2. Reliable source pipeline (fetch >= 90%, parse >= 90%, >= 10 fetches)
  const appSources = await db
    .select({ id: sources.id })
    .from(sources)
    .where(and(eq(sources.appId, appId), eq(sources.status, "active")))
    .all();

  let fetchReliable = false;
  if (appSources.length > 0) {
    const recentFetches = await db
      .select({ fetchStatus: sourceFetches.fetchStatus })
      .from(sourceFetches)
      .innerJoin(sources, eq(sourceFetches.sourceId, sources.id))
      .where(eq(sources.appId, appId))
      .orderBy(desc(sourceFetches.fetchedAt))
      .limit(20)
      .all();

    const recentParses = await db
      .select({ runStatus: parserRuns.runStatus })
      .from(parserRuns)
      .innerJoin(sourceFetches, eq(parserRuns.sourceFetchId, sourceFetches.id))
      .innerJoin(sources, eq(sourceFetches.sourceId, sources.id))
      .where(eq(sources.appId, appId))
      .orderBy(desc(parserRuns.startedAt))
      .limit(20)
      .all();

    const fetchSuccessRate =
      recentFetches.length >= 10
        ? (recentFetches.filter(
            (f) => f.fetchStatus === "success" || f.fetchStatus === "not_modified",
          ).length /
            recentFetches.length) *
          100
        : 0;
    const parseSuccessRate =
      recentParses.length >= 10
        ? (recentParses.filter((p) => p.runStatus === "success" || p.runStatus === "partial")
            .length /
            recentParses.length) *
          100
        : 0;

    fetchReliable = recentFetches.length >= 10 && fetchSuccessRate >= 90 && parseSuccessRate >= 90;
  }

  requirements.push({
    name: "Reliable source pipeline",
    met: fetchReliable,
    detail: fetchReliable
      ? "Fetch and parse success rates >= 90% with >= 10 samples"
      : "Insufficient fetch/parse history or success rate below 90%",
  });

  // 3. Deterministic publication (confidence >= 80, pipeline source)
  const latest = await db
    .select()
    .from(appLatestReleases)
    .where(and(eq(appLatestReleases.appId, appId), eq(appLatestReleases.channel, "stable")))
    .get();

  const deterministicPub =
    latest !== undefined &&
    latest.confidence !== null &&
    latest.confidence >= 80 &&
    latest.decisionSource === "pipeline";

  requirements.push({
    name: "Deterministic publication",
    met: deterministicPub,
    detail: deterministicPub
      ? `Stable release published via pipeline with confidence ${latest?.confidence}`
      : "No stable release via pipeline with confidence >= 80",
  });

  // 4. No unresolved disputes
  const openReviews = await db
    .select({ count: sql<number>`count(*)` })
    .from(reviewQueue)
    .where(and(eq(reviewQueue.relatedId, appId), eq(reviewQueue.status, "pending")))
    .get();

  const noDisputes = (openReviews?.count ?? 0) === 0;
  requirements.push({
    name: "No unresolved review items",
    met: noDisputes,
    detail: noDisputes
      ? "No pending review queue items"
      : `${openReviews?.count} pending review items`,
  });

  // 5. Acceptable trust metadata (signature != invalid on primary artifact)
  let trustAcceptable = false;
  if (latest) {
    const primaryArt = await db
      .select()
      .from(artifacts)
      .where(and(eq(artifacts.releaseId, latest.releaseId), eq(artifacts.isPrimary, true)))
      .get();
    trustAcceptable = !primaryArt || primaryArt.signatureStatus !== "invalid";
  }

  requirements.push({
    name: "Acceptable artifact trust",
    met: trustAcceptable,
    detail: trustAcceptable
      ? "Primary artifact signature is not invalid"
      : "Primary artifact has invalid signature",
  });

  // 6. Recent review (within 90 days)
  const app = await db.select().from(apps).where(eq(apps.id, appId)).get();
  const recentReview =
    app?.lastReviewedAt !== null &&
    app?.lastReviewedAt !== undefined &&
    Date.now() - new Date(app.lastReviewedAt).getTime() < 90 * 24 * 60 * 60 * 1000;

  requirements.push({
    name: "Recent review",
    met: recentReview,
    detail: recentReview
      ? `Last reviewed: ${app?.lastReviewedAt}`
      : "No review within last 90 days",
  });

  const eligible = requirements.every((r) => r.met);
  return { eligible, requirements };
}

export async function autoPromoteVerification(
  db: ReturnType<typeof createDb>,
  appId: string,
): Promise<void> {
  const app = await db.select().from(apps).where(eq(apps.id, appId)).get();
  if (!app) return;

  const { eligible } = await checkVerificationRequirements(db, appId);
  if (!eligible) return;

  let newTier: "provisional" | "verified" | null = null;
  if (app.verificationTier === "unverified") newTier = "provisional";
  else if (app.verificationTier === "provisional") newTier = "verified";

  if (!newTier) return;

  const now = new Date().toISOString();
  await db
    .update(apps)
    .set({ verificationTier: newTier, updatedAt: now })
    .where(eq(apps.id, appId));

  await db.insert(auditLog).values({
    id: generateId(idPrefixes.auditLog),
    eventType: "verification_auto_promoted",
    actorType: "system",
    actorId: null,
    targetType: "app",
    targetId: appId,
    payloadJson: JSON.stringify({ from: app.verificationTier, to: newTier }),
    createdAt: now,
  });
}
