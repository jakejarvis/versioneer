import { env } from "cloudflare:workers";
import { desc, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createDb, generateId, idPrefixes, sources } from "@versioneer/db";

// Import the default export — it's a WorkerEntrypoint class
import PipelineWorker from "../index";

// Stub SOURCE_PIPELINE so `scheduled()` doesn't trigger real workflow instances
// (which run in separate miniflare isolates and produce uncaught exceptions).
type MockWorkflowCreateOptions = {
  params?: { sourceId: string; reason: string; force: boolean };
};

const mockWorkflowBinding = {
  create: vi.fn<(options: MockWorkflowCreateOptions) => Promise<{ id: string }>>(),
  createBatch: vi.fn<(batch: MockWorkflowCreateOptions[]) => Promise<Array<{ id: string }>>>(),
};

function createWorkerInstance() {
  const instance = Object.create(PipelineWorker.prototype);
  instance.env = { ...env, SOURCE_PIPELINE: mockWorkflowBinding };
  instance.ctx = {
    waitUntil: vi.fn<(promise: Promise<unknown>) => void>(),
    passThroughOnException: vi.fn<() => void>(),
  };
  return instance as InstanceType<typeof PipelineWorker>;
}

async function disableExistingSources(db: ReturnType<typeof createDb>) {
  await db
    .update(sources)
    .set({ status: "disabled" })
    .where(sql`1 = 1`);
}

async function latestPollRun(db: ReturnType<typeof createDb>) {
  const { cronJobRuns } = await import("@versioneer/db");
  return db
    .select()
    .from(cronJobRuns)
    .where(sql`${cronJobRuns.jobType} = 'poll_sources'`)
    .orderBy(desc(cronJobRuns.startedAt))
    .get();
}

async function insertTestApp(db: ReturnType<typeof createDb>, name: string) {
  const { apps } = await import("@versioneer/db");
  const appId = generateId(idPrefixes.app);
  await db.insert(apps).values({
    id: appId,
    slug: `${name}-${appId.slice(-8)}`,
    canonicalName: name,
    status: "public",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  });
  return appId;
}

async function insertActiveSource(
  db: ReturnType<typeof createDb>,
  appId: string,
  values: Partial<typeof sources.$inferInsert> = {},
) {
  const sourceId = values.id ?? generateId(idPrefixes.source);
  await db.insert(sources).values({
    id: sourceId,
    appId,
    sourceType: "sparkle",
    parserKey: "sparkle",
    baseUrl: `https://test-scheduled.example.com/${sourceId}.xml`,
    reviewStatus: "approved",
    role: "authority",
    status: "active",
    pollIntervalMinutes: 15,
    ordinal: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...values,
  });
  return sourceId;
}

describe("scheduled handler", () => {
  beforeEach(() => {
    mockWorkflowBinding.create.mockReset();
    mockWorkflowBinding.createBatch.mockReset();
    mockWorkflowBinding.create.mockResolvedValue({ id: "wf_mock" });
    mockWorkflowBinding.createBatch.mockImplementation(async (batch) => {
      return batch.map((_job, index) => ({ id: `wf_batch_${index}` }));
    });
  });

  it("polls overdue sources and logs a cron job run", async () => {
    const db = createDb(env.DB);
    await disableExistingSources(db);
    const appId = await insertTestApp(db, "Scheduled Test App");
    await insertActiveSource(db, appId);

    const worker = createWorkerInstance();
    const event = { scheduledTime: Date.now(), cron: "*/15 * * * *" } as ScheduledEvent;
    await worker.scheduled(event);

    const pollRun = await latestPollRun(db);
    expect(pollRun).toBeDefined();
    expect(pollRun!.status).toBe("completed");
    expect(pollRun!.itemsTotal).toBe(1);
    expect(pollRun!.itemsQueued).toBe(1);
    expect(mockWorkflowBinding.createBatch).toHaveBeenCalledTimes(1);
    expect(mockWorkflowBinding.createBatch.mock.calls[0]![0]).toHaveLength(1);
    expect(mockWorkflowBinding.create).not.toHaveBeenCalled();
  });

  it("skips sources that are not yet due", async () => {
    const db = createDb(env.DB);
    await disableExistingSources(db);
    const appId = await insertTestApp(db, "Fresh App");
    await insertActiveSource(db, appId, {
      appId,
      pollIntervalMinutes: 60,
      lastFetchedAt: new Date().toISOString(),
    });

    const worker = createWorkerInstance();
    const event = { scheduledTime: Date.now(), cron: "*/15 * * * *" } as ScheduledEvent;
    await worker.scheduled(event);

    const pollRun = await latestPollRun(db);
    expect(pollRun).toBeDefined();
    expect(pollRun!.status).toBe("completed");
    expect(pollRun!.itemsTotal).toBe(1);
    expect(pollRun!.itemsQueued).toBe(0);
    expect(mockWorkflowBinding.createBatch).not.toHaveBeenCalled();
    expect(mockWorkflowBinding.create).not.toHaveBeenCalled();
  });

  it("queues due source workflows with createBatch chunks of 100", async () => {
    const db = createDb(env.DB);
    await disableExistingSources(db);
    const appId = await insertTestApp(db, "Batch App");

    for (let index = 0; index < 105; index++) {
      await insertActiveSource(db, appId, { ordinal: index });
    }

    const worker = createWorkerInstance();
    const event = { scheduledTime: Date.now(), cron: "*/15 * * * *" } as ScheduledEvent;
    await worker.scheduled(event);

    const pollRun = await latestPollRun(db);
    expect(pollRun).toBeDefined();
    expect(pollRun!.status).toBe("completed");
    expect(pollRun!.itemsTotal).toBe(105);
    expect(pollRun!.itemsQueued).toBe(105);
    expect(mockWorkflowBinding.createBatch).toHaveBeenCalledTimes(2);
    expect(mockWorkflowBinding.createBatch.mock.calls[0]![0]).toHaveLength(100);
    expect(mockWorkflowBinding.createBatch.mock.calls[1]![0]).toHaveLength(5);
    expect(mockWorkflowBinding.create).not.toHaveBeenCalled();
  });

  it("falls back to per-source workflow creation when a batch fails", async () => {
    const db = createDb(env.DB);
    await disableExistingSources(db);
    const appId = await insertTestApp(db, "Fallback App");

    for (let index = 0; index < 3; index++) {
      await insertActiveSource(db, appId, { ordinal: index });
    }

    mockWorkflowBinding.createBatch.mockRejectedValueOnce(new Error("batch unavailable"));

    const worker = createWorkerInstance();
    const event = { scheduledTime: Date.now(), cron: "*/15 * * * *" } as ScheduledEvent;
    await worker.scheduled(event);

    const pollRun = await latestPollRun(db);
    expect(pollRun).toBeDefined();
    expect(pollRun!.status).toBe("completed");
    expect(pollRun!.itemsTotal).toBe(3);
    expect(pollRun!.itemsQueued).toBe(3);
    expect(mockWorkflowBinding.createBatch).toHaveBeenCalledTimes(1);
    expect(mockWorkflowBinding.create).toHaveBeenCalledTimes(3);
  });
});
