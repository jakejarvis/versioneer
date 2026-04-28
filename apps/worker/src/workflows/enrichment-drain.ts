import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import { createLogger } from "@versioneer/core/logger";
import { captureServerEvent, captureServerException } from "@versioneer/core/observability";
import {
  recordJobFailure,
  resolveJobFailure,
  type EnrichmentDrainJob,
} from "@versioneer/core/pipeline";
import { createDb, cronJobRuns } from "@versioneer/db";

import {
  listEnrichmentCandidates,
  runEnrichmentBatch,
  type EnrichmentBatchResult,
} from "../enrichment";

const MAX_DRAIN_BATCHES = 500;

interface EnrichmentDrainTotals {
  batches: number;
  attempted: number;
  succeeded: number;
  failed: number;
  errors: Array<{ discoveredAppId: string; errorMessage: string }>;
  hasMore: boolean;
}

function mergeBatch(totals: EnrichmentDrainTotals, batch: EnrichmentBatchResult) {
  totals.batches++;
  totals.attempted += batch.attempted;
  totals.succeeded += batch.succeeded;
  totals.failed += batch.failed;
  totals.errors.push(...batch.errors);
}

function persistableTotals(totals: EnrichmentDrainTotals) {
  return {
    batches: totals.batches,
    attempted: totals.attempted,
    succeeded: totals.succeeded,
    failed: totals.failed,
    errors: totals.errors.slice(0, 50),
    hasMore: totals.hasMore,
  };
}

export class EnrichmentDrainWorkflow extends WorkflowEntrypoint<Env, EnrichmentDrainJob> {
  async run(event: WorkflowEvent<EnrichmentDrainJob>, step: WorkflowStep) {
    const { runId, trigger, failureJobKey } = event.payload;
    const db = createDb(this.env.DB);
    const log = createLogger({ workflow: "enrichment-drain", runId, trigger });
    const jobKey = failureJobKey ?? trigger;
    const totals: EnrichmentDrainTotals = {
      batches: 0,
      attempted: 0,
      succeeded: 0,
      failed: 0,
      errors: [],
      hasMore: false,
    };

    log.info("enrichment drain started", { jobKey, maxBatches: MAX_DRAIN_BATCHES });

    try {
      for (let batchIndex = 0; batchIndex < MAX_DRAIN_BATCHES; batchIndex++) {
        const batch = await step.do<EnrichmentBatchResult>(
          `enrich-discoveries-${batchIndex + 1}`,
          { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" } },
          async () =>
            runEnrichmentBatch({
              db,
              env: this.env,
              log: log.child({ batchIndex: batchIndex + 1 }),
            }),
        );

        log.info("enrichment drain batch completed", {
          batchIndex: batchIndex + 1,
          candidates: batch.candidateCount,
          attempted: batch.attempted,
          succeeded: batch.succeeded,
          failed: batch.failed,
        });

        if (batch.candidateCount === 0) {
          log.info("enrichment drain found no remaining candidates", {
            batchIndex: batchIndex + 1,
            attemptedTotal: totals.attempted,
          });
          break;
        }
        mergeBatch(totals, batch);
      }

      const remaining = await step.do("check-remaining-discoveries", async () =>
        listEnrichmentCandidates(db, 1),
      );
      totals.hasMore = remaining.length > 0;
      log.info("enrichment drain remaining check completed", {
        hasMore: totals.hasMore,
        batches: totals.batches,
        attempted: totals.attempted,
        succeeded: totals.succeeded,
        failed: totals.failed,
      });
      if (totals.hasMore) {
        throw new Error(
          `Enrichment drain stopped after ${MAX_DRAIN_BATCHES} batches with work remaining`,
        );
      }

      await db
        .update(cronJobRuns)
        .set({
          status: "completed",
          itemsQueued: totals.succeeded,
          itemsTotal: totals.attempted,
          resultJson: JSON.stringify(persistableTotals(totals)),
          errorMessage: null,
          completedAt: new Date().toISOString(),
        })
        .where(eq(cronJobRuns.id, runId));

      await resolveJobFailure({
        db,
        jobType: "enrich_discovered_apps",
        relatedId: null,
        jobKey,
      });

      const summary = persistableTotals(totals);
      log.info("enrichment drain completed", summary);
      this.ctx.waitUntil(
        captureServerEvent(this.env, {
          event: "worker_enrichment_drain_completed",
          properties: {
            surface: "worker",
            target_type: "cron_job",
            target_id: runId,
            job_type: "enrich_discovered_apps",
            trigger,
            status: "completed",
            ...summary,
          },
        }),
      );
      return { status: "completed", ...summary };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log.error("enrichment drain failed", { ...persistableTotals(totals), error });

      await db
        .update(cronJobRuns)
        .set({
          status: "failed",
          itemsQueued: totals.succeeded,
          itemsTotal: totals.attempted,
          resultJson: JSON.stringify(persistableTotals(totals)),
          errorMessage,
          completedAt: new Date().toISOString(),
        })
        .where(eq(cronJobRuns.id, runId));

      await recordJobFailure({
        db,
        jobType: "enrich_discovered_apps",
        relatedId: null,
        jobKey,
        errorMessage,
      });
      this.ctx.waitUntil(
        captureServerException(this.env, {
          error,
          properties: {
            surface: "worker",
            workflow: "enrichment-drain",
            target_type: "cron_job",
            target_id: runId,
            job_type: "enrich_discovered_apps",
            trigger,
            status: "failed",
          },
        }),
      );

      throw error;
    }
  }
}
