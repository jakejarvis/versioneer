import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createLogger } from "@versioneer/core/logger";
import type { InventoryIngestionQueueMessage } from "@versioneer/core/pipeline";
import {
  createDb,
  generateId,
  idPrefixes,
  inventoryIngestionJobs,
  jobFailures,
} from "@versioneer/db";

import PipelineWorker, { repairInventoryIngestionQueue } from "../index";
import { touchInventoryIngestionJob } from "../inventory-ingestion-heartbeat";

const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");
const TEST_NOW_ISO = TEST_NOW.toISOString();
const TEST_STALE_ISO = new Date(TEST_NOW.getTime() - 10 * 60 * 1000).toISOString();
const TEST_LONG_STALE_ISO = new Date(TEST_NOW.getTime() - 2 * 60 * 60 * 1000).toISOString();

type MockWorkflowCreateOptions = {
  id?: string;
  params?: InventoryIngestionQueueMessage;
};

const mockInventoryWorkflow = {
  create: vi.fn<(options: MockWorkflowCreateOptions) => Promise<{ id: string }>>(),
};

function createWorkerInstance() {
  const instance = Object.create(PipelineWorker.prototype);
  instance.env = { ...env, INVENTORY_INGESTION: mockInventoryWorkflow };
  instance.ctx = {
    waitUntil: vi.fn<(promise: Promise<unknown>) => void>(),
    passThroughOnException: vi.fn<() => void>(),
  };
  return instance as InstanceType<typeof PipelineWorker>;
}

function createMessage(body: unknown) {
  const ack = vi.fn<() => void>();
  const retry = vi.fn<(_options?: QueueRetryOptions) => void>();
  return {
    id: generateId("msg"),
    timestamp: TEST_NOW,
    body,
    attempts: 1,
    ack,
    retry,
  } as unknown as Message<InventoryIngestionQueueMessage> & {
    ack: typeof ack;
    retry: typeof retry;
  };
}

function createBatch(messages: Message<InventoryIngestionQueueMessage>[]) {
  return {
    messages,
    queue: "versioneer-inventory-ingestion-dev",
    metadata: { metrics: { batchSize: messages.length, retries: 0 } },
    ackAll: vi.fn<() => void>(),
    retryAll: vi.fn<(_options?: QueueRetryOptions) => void>(),
  } as unknown as MessageBatch<InventoryIngestionQueueMessage>;
}

async function insertIngestionJob(
  db: ReturnType<typeof createDb>,
  overrides: Partial<typeof inventoryIngestionJobs.$inferInsert> = {},
) {
  const id = overrides.id ?? generateId(idPrefixes.inventoryIngestionJob);
  await db.insert(inventoryIngestionJobs).values({
    id,
    status: "pending",
    payloadR2Key: `inventory-ingestions/test/${id}.json`,
    attemptCount: 0,
    itemsTotal: 1,
    createdAt: TEST_NOW_ISO,
    updatedAt: TEST_NOW_ISO,
    ...overrides,
  });
  return id;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
  mockInventoryWorkflow.create.mockReset();
  mockInventoryWorkflow.create.mockImplementation(async (options) => ({
    id: options.id ?? "wf_default",
  }));
  const db = createDb(env.DB);
  await db.delete(jobFailures).where(sql`1 = 1`);
  await db.delete(inventoryIngestionJobs).where(sql`1 = 1`);
});

describe("inventory ingestion queue", () => {
  it("starts a deterministic workflow for a pending job and acks the message", async () => {
    const db = createDb(env.DB);
    const ingestionId = await insertIngestionJob(db);
    const message = createMessage({ ingestionId });

    await createWorkerInstance().queue(createBatch([message]));

    expect(mockInventoryWorkflow.create).toHaveBeenCalledWith({
      id: `${ingestionId}-1`,
      params: { ingestionId },
    });
    expect(message.ack).toHaveBeenCalledTimes(1);
    expect(message.retry).not.toHaveBeenCalled();

    const job = await db
      .select()
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, ingestionId))
      .get();
    expect(job?.status).toBe("queued");
    expect(job?.attemptCount).toBe(1);
    expect(job?.workflowInstanceId).toBe(`${ingestionId}-1`);
  });

  it("acks duplicate completed and running messages without starting another workflow", async () => {
    const db = createDb(env.DB);
    const completedIngestionId = await insertIngestionJob(db, { status: "completed" });
    const runningIngestionId = await insertIngestionJob(db, { status: "running", attemptCount: 1 });
    const completedMessage = createMessage({ ingestionId: completedIngestionId });
    const runningMessage = createMessage({ ingestionId: runningIngestionId });

    await createWorkerInstance().queue(createBatch([completedMessage, runningMessage]));

    expect(mockInventoryWorkflow.create).not.toHaveBeenCalled();
    expect(completedMessage.ack).toHaveBeenCalledTimes(1);
    expect(runningMessage.ack).toHaveBeenCalledTimes(1);
  });

  it("retries the message and records failure metadata when workflow creation fails", async () => {
    const db = createDb(env.DB);
    const ingestionId = await insertIngestionJob(db);
    const message = createMessage({ ingestionId });
    mockInventoryWorkflow.create.mockRejectedValueOnce(new Error("workflow unavailable"));

    await createWorkerInstance().queue(createBatch([message]));

    expect(message.ack).not.toHaveBeenCalled();
    expect(message.retry).toHaveBeenCalledWith({ delaySeconds: 60 });

    const job = await db
      .select()
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, ingestionId))
      .get();
    expect(job?.status).toBe("failed");
    expect(job?.attemptCount).toBe(1);
    expect(job?.errorMessage).toBe("workflow unavailable");

    const failure = await db
      .select()
      .from(jobFailures)
      .where(eq(jobFailures.relatedId, ingestionId))
      .get();
    expect(failure?.jobType).toBe("inventory_ingestion");
    expect(failure?.jobKey).toBe("queue");
    expect(failure?.errorMessage).toBe("workflow unavailable");
  });
});

describe("inventory ingestion repair", () => {
  it("re-enqueues stale pending and retryable failed jobs", async () => {
    const db = createDb(env.DB);
    const stalePendingId = await insertIngestionJob(db, {
      status: "pending",
      updatedAt: TEST_STALE_ISO,
    });
    const retryableFailedId = await insertIngestionJob(db, {
      status: "failed",
      attemptCount: 4,
      updatedAt: TEST_STALE_ISO,
    });
    await insertIngestionJob(db, {
      status: "pending",
      updatedAt: TEST_NOW_ISO,
    });
    await insertIngestionJob(db, {
      status: "failed",
      attemptCount: 5,
      updatedAt: TEST_STALE_ISO,
    });

    const send = vi.fn<(message: InventoryIngestionQueueMessage) => Promise<QueueSendResponse>>(
      async () => ({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      }),
    );
    const queue = { send } as unknown as Queue<InventoryIngestionQueueMessage>;

    const repaired = await repairInventoryIngestionQueue({
      db,
      queue,
      log: createLogger({ test: "inventory_ingestion_repair" }),
      now: TEST_NOW,
    });

    expect(repaired).toBe(2);
    expect(send.mock.calls.map((call) => call[0])).toEqual([
      { ingestionId: stalePendingId },
      { ingestionId: retryableFailedId },
    ]);
  });

  it("reclaims stale queued and long-stale running jobs before re-enqueueing them", async () => {
    const db = createDb(env.DB);
    const staleQueuedId = await insertIngestionJob(db, {
      status: "queued",
      attemptCount: 1,
      workflowInstanceId: "wf-stale-queued",
      updatedAt: TEST_STALE_ISO,
      queuedAt: TEST_STALE_ISO,
    });
    const staleRunningId = await insertIngestionJob(db, {
      status: "running",
      attemptCount: 1,
      workflowInstanceId: "wf-stale-running",
      updatedAt: TEST_LONG_STALE_ISO,
      queuedAt: TEST_LONG_STALE_ISO,
      startedAt: TEST_LONG_STALE_ISO,
    });
    await insertIngestionJob(db, {
      status: "running",
      attemptCount: 1,
      workflowInstanceId: "wf-fresh-running",
      updatedAt: TEST_STALE_ISO,
      queuedAt: TEST_STALE_ISO,
      startedAt: TEST_STALE_ISO,
    });

    const send = vi.fn<(message: InventoryIngestionQueueMessage) => Promise<QueueSendResponse>>(
      async () => ({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      }),
    );
    const queue = { send } as unknown as Queue<InventoryIngestionQueueMessage>;

    const repaired = await repairInventoryIngestionQueue({
      db,
      queue,
      log: createLogger({ test: "inventory_ingestion_repair_reclaim" }),
      now: TEST_NOW,
    });

    expect(repaired).toBe(2);
    expect(send.mock.calls.map((call) => call[0])).toEqual([
      { ingestionId: staleQueuedId },
      { ingestionId: staleRunningId },
    ]);

    const staleQueuedJob = await db
      .select()
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, staleQueuedId))
      .get();
    expect(staleQueuedJob?.status).toBe("pending");
    expect(staleQueuedJob?.workflowInstanceId).toBeNull();

    const staleRunningJob = await db
      .select()
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, staleRunningId))
      .get();
    expect(staleRunningJob?.status).toBe("pending");
    expect(staleRunningJob?.workflowInstanceId).toBeNull();
  });

  it("does not reclaim a running job whose heartbeat refreshed updatedAt", async () => {
    const db = createDb(env.DB);
    const runningIngestionId = await insertIngestionJob(db, {
      status: "running",
      attemptCount: 1,
      workflowInstanceId: "wf-running",
      updatedAt: TEST_LONG_STALE_ISO,
      queuedAt: TEST_LONG_STALE_ISO,
      startedAt: TEST_LONG_STALE_ISO,
    });

    await touchInventoryIngestionJob({
      db,
      ingestionId: runningIngestionId,
      now: TEST_NOW_ISO,
    });

    const send = vi.fn<(message: InventoryIngestionQueueMessage) => Promise<QueueSendResponse>>(
      async () => ({
        metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
      }),
    );
    const queue = { send } as unknown as Queue<InventoryIngestionQueueMessage>;

    const repaired = await repairInventoryIngestionQueue({
      db,
      queue,
      log: createLogger({ test: "inventory_ingestion_repair_heartbeat" }),
      now: TEST_NOW,
    });

    expect(repaired).toBe(0);
    expect(send).not.toHaveBeenCalled();

    const runningJob = await db
      .select()
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, runningIngestionId))
      .get();
    expect(runningJob?.status).toBe("running");
    expect(runningJob?.workflowInstanceId).toBe("wf-running");
    expect(runningJob?.updatedAt).toBe(TEST_NOW_ISO);
  });
});
