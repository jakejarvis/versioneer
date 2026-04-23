import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq } from "drizzle-orm";

import { createLogger } from "@versioneer/core/logger";
import { captureServerEvent, captureServerException } from "@versioneer/core/observability";
import {
  createInventoryIngestionSuggestions,
  inventoryIngestionWorkflowPayloadSchema,
  parseInventoryIngestionPayload,
  recordJobFailure,
  resolveJobFailure,
  storeCatalogInventoryIcons,
  storeDiscoveredInventoryIcons,
  type InventoryCatalogIconResult,
  type InventoryIngestionPayload,
  type InventoryIngestionStepResult,
  type InventoryIngestionWorkflowPayload,
} from "@versioneer/core/pipeline";
import { createDb, inventoryIngestionJobs } from "@versioneer/db";

const INVENTORY_INGESTION_FAILURE_KEYS = [
  "handoff",
  "enqueue",
  "queue",
  "repair",
  "workflow",
] as const;

type InventoryIngestionJobRow = Pick<
  typeof inventoryIngestionJobs.$inferSelect,
  "id" | "status" | "payloadR2Key" | "itemsTotal"
>;

interface LoadedInventoryIngestion {
  alreadyCompleted: boolean;
  job: InventoryIngestionJobRow;
  payload: InventoryIngestionPayload | null;
  itemsTotal: number;
}

interface InventoryIngestionTotals {
  itemsTotal: number;
  discoveredIcons: InventoryIngestionStepResult;
  catalogIcons: InventoryCatalogIconResult;
  suggestions: InventoryIngestionStepResult;
}

function emptyStepResult(): InventoryIngestionStepResult {
  return { attempted: 0, succeeded: 0, failed: 0 };
}

function emptyCatalogIconResult(): InventoryCatalogIconResult {
  return { attempted: 0, succeeded: 0, failed: 0, changed: 0 };
}

function payloadItemCount(payload: InventoryIngestionPayload): number {
  return payload.discoveredIconCandidates.length + payload.matchedAppCandidates.length;
}

function countFailedItems(totals: InventoryIngestionTotals): number {
  return totals.discoveredIcons.failed + totals.catalogIcons.failed + totals.suggestions.failed;
}

async function resolveInventoryIngestionFailures(
  db: ReturnType<typeof createDb>,
  ingestionId: string,
): Promise<void> {
  for (const jobKey of INVENTORY_INGESTION_FAILURE_KEYS) {
    await resolveJobFailure({
      db,
      jobType: "inventory_ingestion",
      relatedId: ingestionId,
      jobKey,
    });
  }
}

export class InventoryIngestionWorkflow extends WorkflowEntrypoint<
  Env,
  InventoryIngestionWorkflowPayload
> {
  async run(event: WorkflowEvent<InventoryIngestionWorkflowPayload>, step: WorkflowStep) {
    const { ingestionId } = inventoryIngestionWorkflowPayloadSchema.parse(event.payload);
    const db = createDb(this.env.DB);
    const log = createLogger({ workflow: "inventory_ingestion", ingestionId });
    const totals: InventoryIngestionTotals = {
      itemsTotal: 0,
      discoveredIcons: emptyStepResult(),
      catalogIcons: emptyCatalogIconResult(),
      suggestions: emptyStepResult(),
    };
    let payloadR2Key: string | null = null;

    try {
      const loaded = await step.do<LoadedInventoryIngestion>("load-ingestion-payload", async () => {
        const now = new Date().toISOString();
        const job = await db
          .select({
            id: inventoryIngestionJobs.id,
            status: inventoryIngestionJobs.status,
            payloadR2Key: inventoryIngestionJobs.payloadR2Key,
            itemsTotal: inventoryIngestionJobs.itemsTotal,
          })
          .from(inventoryIngestionJobs)
          .where(eq(inventoryIngestionJobs.id, ingestionId))
          .get();
        if (!job) {
          throw new Error(`Inventory ingestion ${ingestionId} does not exist`);
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
          throw new Error(`Inventory ingestion payload ${job.payloadR2Key} does not exist`);
        }

        let parsed: unknown;
        try {
          parsed = JSON.parse(await object.text());
        } catch {
          throw new Error(`Inventory ingestion payload ${job.payloadR2Key} is invalid JSON`);
        }
        const payload = parseInventoryIngestionPayload(parsed);

        await db
          .update(inventoryIngestionJobs)
          .set({
            status: "running",
            startedAt: now,
            updatedAt: now,
            errorMessage: null,
          })
          .where(eq(inventoryIngestionJobs.id, ingestionId));

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

      totals.discoveredIcons = await step.do<InventoryIngestionStepResult>(
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

      totals.suggestions = await step.do<InventoryIngestionStepResult>(
        "create-suggestions",
        { retries: { limit: 2, delay: "10 seconds", backoff: "exponential" } },
        async () =>
          createInventoryIngestionSuggestions({
            db,
            candidates: loaded.payload!.matchedAppCandidates,
            now: loaded.payload!.processedAt,
          }),
      );

      await step.do("mark-completed", async () => {
        const now = new Date().toISOString();
        const failedItems = countFailedItems(totals);
        await db
          .update(inventoryIngestionJobs)
          .set({
            status: "completed",
            itemsTotal: totals.itemsTotal,
            itemsSucceeded: Math.max(0, totals.itemsTotal - failedItems),
            itemsFailed: failedItems,
            errorMessage: null,
            updatedAt: now,
            completedAt: now,
          })
          .where(eq(inventoryIngestionJobs.id, ingestionId));

        await resolveInventoryIngestionFailures(db, ingestionId);
        await this.env.RAW_BUCKET.delete(loaded.job.payloadR2Key);
      });

      log.info("workflow completed", { totals });
      this.ctx.waitUntil(
        captureServerEvent(this.env, {
          event: "worker_inventory_ingestion_completed",
          properties: {
            surface: "worker",
            target_type: "inventory_ingestion_job",
            target_id: ingestionId,
            status: "completed",
            items_total: totals.itemsTotal,
            discovered_icons_failed: totals.discoveredIcons.failed,
            catalog_icons_failed: totals.catalogIcons.failed,
            suggestions_failed: totals.suggestions.failed,
          },
        }),
      );
      return { status: "completed", ...totals };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const now = new Date().toISOString();
      const failedItems = totals.itemsTotal > 0 ? Math.max(1, countFailedItems(totals)) : null;
      log.error("workflow failed", { error });

      await db
        .update(inventoryIngestionJobs)
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
        .where(eq(inventoryIngestionJobs.id, ingestionId));

      await recordJobFailure({
        db,
        jobType: "inventory_ingestion",
        relatedId: ingestionId,
        jobKey: "workflow",
        errorMessage,
      });

      if (payloadR2Key) {
        log.info("preserved ingestion payload after failure", { payloadR2Key });
      }

      this.ctx.waitUntil(
        captureServerException(this.env, {
          error,
          properties: {
            surface: "worker",
            workflow: "inventory_ingestion",
            target_type: "inventory_ingestion_job",
            target_id: ingestionId,
            status: "failed",
            items_total: totals.itemsTotal,
          },
        }),
      );

      throw error;
    }
  }
}
