import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import { enrichmentDrain } from "@/lib/pipeline";
import {
  handleCaskIndexSync,
  recordJobFailure,
  resolveJobFailure,
} from "@versioneer/core/pipeline";
import { createDb } from "@versioneer/db";
import { cronJobRuns, generateId, idPrefixes, sources } from "@versioneer/db";

import { scheduleSourceFetch } from "./followup-jobs";

type Db = ReturnType<typeof createDb>;
type CronJobType = "poll_sources" | "cask_index_sync" | "enrich_discovered_apps";
type CronTrigger = "manual" | "scheduled";
type CronRunStatus = "running" | "completed" | "failed";

function cronFailureKey(trigger: CronTrigger, failureJobKey?: string | null) {
  return failureJobKey ?? trigger;
}

async function recordCronFailure(params: {
  db: Db;
  jobType: CronJobType;
  trigger: CronTrigger;
  failureJobKey?: string | null;
  errorMessage: string;
}) {
  await recordJobFailure({
    db: params.db,
    jobType: params.jobType,
    relatedId: null,
    jobKey: cronFailureKey(params.trigger, params.failureJobKey),
    errorMessage: params.errorMessage,
  });
}

async function resolveCronFailure(params: {
  db: Db;
  jobType: CronJobType;
  trigger: CronTrigger;
  failureJobKey?: string | null;
}) {
  await resolveJobFailure({
    db: params.db,
    jobType: params.jobType,
    relatedId: null,
    jobKey: cronFailureKey(params.trigger, params.failureJobKey),
  });
}

export async function runPollSourcesJob(params: {
  db: Db;
  force: boolean;
  actorId: string | null;
  trigger?: CronTrigger;
  failureJobKey?: string | null;
}) {
  const { db, force, actorId } = params;
  const trigger = params.trigger ?? "manual";
  const now = new Date();
  const runId = generateId(idPrefixes.cronJobRun);

  await db.insert(cronJobRuns).values({
    id: runId,
    jobType: "poll_sources",
    trigger,
    status: "running",
    actorId,
    startedAt: now.toISOString(),
  });

  try {
    const activeSources = await db.select().from(sources).where(eq(sources.status, "active")).all();

    const dueSources = force
      ? activeSources
      : activeSources.filter((source) => {
          const lastFetched = source.lastFetchedAt ? new Date(source.lastFetchedAt) : null;
          const intervalMs = source.pollIntervalMinutes * 60 * 1000;
          return !lastFetched || now.getTime() - lastFetched.getTime() >= intervalMs;
        });

    const queuedSourceIds: string[] = [];
    const failedSources: Array<{ sourceId: string; errorMessage: string | null }> = [];
    for (const source of dueSources) {
      const result = await scheduleSourceFetch({
        db,
        sourceId: source.id,
        reason: trigger === "manual" ? "manual" : "scheduled",
        force,
      });
      if (result.ok) {
        queuedSourceIds.push(source.id);
      } else {
        failedSources.push({
          sourceId: source.id,
          errorMessage: result.errorMessage ?? null,
        });
      }
    }

    const status: CronRunStatus = failedSources.length > 0 ? "failed" : "completed";
    const errorMessage =
      failedSources.length > 0
        ? `${failedSources.length} source enqueue${failedSources.length === 1 ? "" : "s"} failed`
        : null;
    const resultJson = JSON.stringify({ queuedSourceIds, failedSources });

    await db
      .update(cronJobRuns)
      .set({
        status,
        itemsQueued: queuedSourceIds.length,
        itemsTotal: activeSources.length,
        resultJson,
        errorMessage,
        completedAt: new Date().toISOString(),
      })
      .where(eq(cronJobRuns.id, runId));

    if (status === "failed" && errorMessage) {
      await recordCronFailure({
        db,
        jobType: "poll_sources",
        trigger,
        failureJobKey: params.failureJobKey,
        errorMessage,
      });
    } else {
      await resolveCronFailure({
        db,
        jobType: "poll_sources",
        trigger,
        failureJobKey: params.failureJobKey,
      });
    }

    return {
      id: runId,
      status,
      itemsQueued: queuedSourceIds.length,
      itemsTotal: activeSources.length,
      failedCount: failedSources.length,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db
      .update(cronJobRuns)
      .set({
        status: "failed",
        errorMessage,
        completedAt: new Date().toISOString(),
      })
      .where(eq(cronJobRuns.id, runId));
    await recordCronFailure({
      db,
      jobType: "poll_sources",
      trigger,
      failureJobKey: params.failureJobKey,
      errorMessage,
    });
    throw error;
  }
}

export async function runCaskIndexSyncJob(params: {
  db: Db;
  actorId: string | null;
  trigger?: CronTrigger;
  failureJobKey?: string | null;
}) {
  const { db, actorId } = params;
  const trigger = params.trigger ?? "manual";
  const runId = generateId(idPrefixes.cronJobRun);
  const startedAt = new Date().toISOString();

  await db.insert(cronJobRuns).values({
    id: runId,
    jobType: "cask_index_sync",
    trigger,
    status: "running",
    actorId,
    startedAt,
  });

  try {
    await handleCaskIndexSync({ reason: trigger, force: trigger === "manual" }, env);

    await db
      .update(cronJobRuns)
      .set({
        status: "completed",
        itemsQueued: 1,
        itemsTotal: 1,
        completedAt: new Date().toISOString(),
      })
      .where(eq(cronJobRuns.id, runId));

    await resolveCronFailure({
      db,
      jobType: "cask_index_sync",
      trigger,
      failureJobKey: params.failureJobKey,
    });

    return { id: runId, status: "completed" as const, itemsQueued: 1, itemsTotal: 1 };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db
      .update(cronJobRuns)
      .set({
        status: "failed",
        errorMessage,
        completedAt: new Date().toISOString(),
      })
      .where(eq(cronJobRuns.id, runId));
    await recordCronFailure({
      db,
      jobType: "cask_index_sync",
      trigger,
      failureJobKey: params.failureJobKey,
      errorMessage,
    });
    throw error;
  }
}

export async function startEnrichmentDrainJob(params: {
  db: Db;
  actorId: string | null;
  trigger?: CronTrigger;
  failureJobKey?: string | null;
}) {
  const { db, actorId } = params;
  const trigger = params.trigger ?? "manual";
  const runId = generateId(idPrefixes.cronJobRun);
  const startedAt = new Date().toISOString();

  await db.insert(cronJobRuns).values({
    id: runId,
    jobType: "enrich_discovered_apps",
    trigger,
    status: "running",
    actorId,
    startedAt,
  });

  try {
    await enrichmentDrain.create({
      params: {
        runId,
        trigger,
        actorId,
        failureJobKey: cronFailureKey(trigger, params.failureJobKey),
      },
    });
    return { id: runId, status: "running" as const };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    await db
      .update(cronJobRuns)
      .set({
        status: "failed",
        errorMessage,
        completedAt: new Date().toISOString(),
      })
      .where(eq(cronJobRuns.id, runId));
    await recordCronFailure({
      db,
      jobType: "enrich_discovered_apps",
      trigger,
      failureJobKey: params.failureJobKey,
      errorMessage,
    });
    throw error;
  }
}
