import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import { createLogger } from "@versioneer/core/logger";
import {
  createInventoryFollowupSuggestions,
  inventoryFollowupWorkflowPayloadSchema,
  parseInventoryFollowupPayload,
  recordJobFailure,
  resolveJobFailure,
  storeCatalogInventoryIcons,
  storeDiscoveredInventoryIcons,
  type InventoryCatalogIconResult,
  type InventoryFollowupPayload,
  type InventoryFollowupStepResult,
  type InventoryFollowupWorkflowPayload,
} from "@versioneer/core/pipeline";
import { createDb, inventoryFollowupJobs } from "@versioneer/db";

const INVENTORY_FOLLOWUP_FAILURE_KEYS = [
  "handoff",
  "enqueue",
  "queue",
  "repair",
  "workflow",
] as const;

type InventoryFollowupJobRow = Pick<
  typeof inventoryFollowupJobs.$inferSelect,
  "id" | "status" | "payloadR2Key" | "itemsTotal"
>;

interface LoadedInventoryFollowup {
  alreadyCompleted: boolean;
  job: InventoryFollowupJobRow;
  payload: InventoryFollowupPayload | null;
  itemsTotal: number;
}

interface InventoryFollowupTotals {
  itemsTotal: number;
  discoveredIcons: InventoryFollowupStepResult;
  catalogIcons: InventoryCatalogIconResult;
  suggestions: InventoryFollowupStepResult;
}

function emptyStepResult(): InventoryFollowupStepResult {
  return { attempted: 0, succeeded: 0, failed: 0 };
}

function emptyCatalogIconResult(): InventoryCatalogIconResult {
  return { attempted: 0, succeeded: 0, failed: 0, changed: 0 };
}

function payloadItemCount(payload: InventoryFollowupPayload): number {
  return payload.discoveredIconCandidates.length + payload.matchedAppCandidates.length;
}

function countFailedItems(totals: InventoryFollowupTotals): number {
  return totals.discoveredIcons.failed + totals.catalogIcons.failed + totals.suggestions.failed;
}

async function resolveInventoryFollowupFailures(
  db: ReturnType<typeof createDb>,
  jobId: string,
): Promise<void> {
  for (const jobKey of INVENTORY_FOLLOWUP_FAILURE_KEYS) {
    await resolveJobFailure({
      db,
      jobType: "inventory_followup",
      relatedId: jobId,
      jobKey,
    });
  }
}

export class InventoryFollowupWorkflow extends WorkflowEntrypoint<
  Env,
  InventoryFollowupWorkflowPayload
> {
  async run(event: WorkflowEvent<InventoryFollowupWorkflowPayload>, step: WorkflowStep) {
    const { jobId } = inventoryFollowupWorkflowPayloadSchema.parse(event.payload);
    const db = createDb(this.env.DB);
    const log = createLogger({ workflow: "inventory_followup", jobId });
    const totals: InventoryFollowupTotals = {
      itemsTotal: 0,
      discoveredIcons: emptyStepResult(),
      catalogIcons: emptyCatalogIconResult(),
      suggestions: emptyStepResult(),
    };
    let payloadR2Key: string | null = null;

    try {
      const loaded = await step.do<LoadedInventoryFollowup>("load-followup-payload", async () => {
        const now = new Date().toISOString();
        const job = await db
          .select({
            id: inventoryFollowupJobs.id,
            status: inventoryFollowupJobs.status,
            payloadR2Key: inventoryFollowupJobs.payloadR2Key,
            itemsTotal: inventoryFollowupJobs.itemsTotal,
          })
          .from(inventoryFollowupJobs)
          .where(eq(inventoryFollowupJobs.id, jobId))
          .get();
        if (!job) {
          throw new Error(`Inventory follow-up job ${jobId} does not exist`);
        }

        if (job.status === "completed") {
          return {
            alreadyCompleted: true,
            job,
            payload: null,
            itemsTotal: job.itemsTotal ?? 0,
          };
        }

        const object = await this.env.RAW_BUCKET.get(job.payloadR2Key);
        if (!object) {
          throw new Error(`Inventory follow-up payload ${job.payloadR2Key} does not exist`);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(await object.text());
        } catch {
          throw new Error(`Inventory follow-up payload ${job.payloadR2Key} is invalid JSON`);
        }
        const payload = parseInventoryFollowupPayload(parsed);

        await db
          .update(inventoryFollowupJobs)
          .set({
            status: "running",
            startedAt: now,
            updatedAt: now,
            errorMessage: null,
          })
          .where(eq(inventoryFollowupJobs.id, jobId));

        return {
          alreadyCompleted: false,
          job,
          payload,
          itemsTotal: payloadItemCount(payload),
        };
      });

      payloadR2Key = loaded.job.payloadR2Key;
      totals.itemsTotal = loaded.itemsTotal;

      if (loaded.alreadyCompleted || !loaded.payload) {
        log.info("workflow skipped completed job");
        return { status: "completed", skipped: true };
      }

      totals.discoveredIcons = await step.do<InventoryFollowupStepResult>(
        "store-discovered-icons",
        { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" } },
        async () =>
          storeDiscoveredInventoryIcons({
            db,
            assetsBucket: this.env.ASSETS_BUCKET,
            candidates: loaded.payload!.discoveredIconCandidates,
          }),
      );

      totals.catalogIcons = await step.do<InventoryCatalogIconResult>(
        "store-catalog-icons",
        { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" } },
        async () =>
          storeCatalogInventoryIcons({
            db,
            assetsBucket: this.env.ASSETS_BUCKET,
            cacheKv: this.env.CACHE_KV,
            candidates: loaded.payload!.matchedAppCandidates,
            now: loaded.payload!.processedAt,
          }),
      );

      totals.suggestions = await step.do<InventoryFollowupStepResult>(
        "create-suggestions",
        { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" } },
        async () =>
          createInventoryFollowupSuggestions({
            db,
            candidates: loaded.payload!.matchedAppCandidates,
            now: loaded.payload!.processedAt,
          }),
      );

      await step.do("mark-completed", async () => {
        const now = new Date().toISOString();
        const failedItems = countFailedItems(totals);
        await db
          .update(inventoryFollowupJobs)
          .set({
            status: "completed",
            itemsTotal: totals.itemsTotal,
            itemsSucceeded: Math.max(0, totals.itemsTotal - failedItems),
            itemsFailed: failedItems,
            errorMessage: null,
            updatedAt: now,
            completedAt: now,
          })
          .where(eq(inventoryFollowupJobs.id, jobId));

        await resolveInventoryFollowupFailures(db, jobId);
        await this.env.RAW_BUCKET.delete(loaded.job.payloadR2Key);
      });

      log.info("workflow completed", { totals });
      return { status: "completed", ...totals };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString();
      const failedItems = totals.itemsTotal > 0 ? Math.max(1, countFailedItems(totals)) : null;
      log.error("workflow failed", { error });

      await db
        .update(inventoryFollowupJobs)
        .set({
          status: "failed",
          itemsTotal: totals.itemsTotal || null,
          itemsSucceeded:
            totals.itemsTotal > 0 && failedItems !== null
              ? Math.max(0, totals.itemsTotal - failedItems)
              : null,
          itemsFailed: failedItems,
          errorMessage,
          updatedAt: now,
          completedAt: now,
        })
        .where(eq(inventoryFollowupJobs.id, jobId));

      await recordJobFailure({
        db,
        jobType: "inventory_followup",
        relatedId: jobId,
        jobKey: "workflow",
        errorMessage,
      });

      if (payloadR2Key) {
        log.info("preserved follow-up payload after failure", { payloadR2Key });
      }

      throw error;
    }
  }
}
