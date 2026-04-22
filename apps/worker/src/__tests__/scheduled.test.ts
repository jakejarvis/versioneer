import { env } from "cloudflare:workers";
import { desc, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createDb, cronJobRuns, generateId, idPrefixes, sources } from "@versioneer/db";

// Import the default export — it's a WorkerEntrypoint class
import PipelineWorker from "../index";

// Stub SOURCE_PIPELINE so `scheduled()` doesn't trigger real workflow instances
// (which run in separate miniflare isolates and produce uncaught exceptions).
const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");
const TEST_NOW_ISO = TEST_NOW.toISOString();
const TEST_FUTURE_ISO = new Date(TEST_NOW.getTime() + 60 * 60 * 1000).toISOString();

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
    createdAt: TEST_NOW_ISO,
    updatedAt: TEST_NOW_ISO,
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
    createdAt: TEST_NOW_ISO,
    updatedAt: TEST_NOW_ISO,
    ...values,
  });
  return sourceId;
}

describe("scheduled handler", () => {
  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(TEST_NOW);
    await env.CONFIG_KV.put("cask-index-last-sync", TEST_NOW_ISO);
    await createDb(env.DB)
      .delete(cronJobRuns)
      .where(sql`1 = 1`);
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
    const event = { scheduledTime: TEST_NOW.getTime(), cron: "*/15 * * * *" } as ScheduledEvent;
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
      lastFetchedAt: TEST_NOW_ISO,
      nextPollAt: TEST_FUTURE_ISO,
    });

    const worker = createWorkerInstance();
    const event = { scheduledTime: TEST_NOW.getTime(), cron: "*/15 * * * *" } as ScheduledEvent;
    await worker.scheduled(event);

    const pollRun = await latestPollRun(db);
    expect(pollRun).toBeDefined();
    expect(pollRun!.status).toBe("completed");
    expect(pollRun!.itemsTotal).toBe(0);
    expect(pollRun!.itemsQueued).toBe(0);
    expect(mockWorkflowBinding.createBatch).not.toHaveBeenCalled();
    expect(mockWorkflowBinding.create).not.toHaveBeenCalled();
  });

  it("queues a source once mocked time reaches nextPollAt", async () => {
    const db = createDb(env.DB);
    await disableExistingSources(db);
    const appId = await insertTestApp(db, "Future Due App");
    await insertActiveSource(db, appId, {
      appId,
      pollIntervalMinutes: 60,
      lastFetchedAt: TEST_NOW_ISO,
      nextPollAt: TEST_FUTURE_ISO,
    });

    vi.setSystemTime(new Date(TEST_NOW.getTime() + 61 * 60 * 1000));

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
  });

  it("queues due source workflows with createBatch chunks of 100", async () => {
    const db = createDb(env.DB);
    await disableExistingSources(db);
    const appId = await insertTestApp(db, "Batch App");

    for (let index = 0; index < 105; index++) {
      await insertActiveSource(db, appId, { ordinal: index });
    }

    const worker = createWorkerInstance();
    const event = { scheduledTime: TEST_NOW.getTime(), cron: "*/15 * * * *" } as ScheduledEvent;
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
    const event = { scheduledTime: TEST_NOW.getTime(), cron: "*/15 * * * *" } as ScheduledEvent;
    await worker.scheduled(event);

    const pollRun = await latestPollRun(db);
    expect(pollRun).toBeDefined();
    expect(pollRun!.status).toBe("completed");
    expect(pollRun!.itemsTotal).toBe(3);
    expect(pollRun!.itemsQueued).toBe(3);
    expect(mockWorkflowBinding.createBatch).toHaveBeenCalledTimes(1);
    expect(mockWorkflowBinding.create).toHaveBeenCalledTimes(3);
  });

  it("mirrors scheduled poll queue failures into job failures", async () => {
    const db = createDb(env.DB);
    const { jobFailures } = await import("@versioneer/db");
    await db.delete(jobFailures).where(sql`1 = 1`);
    await disableExistingSources(db);
    const appId = await insertTestApp(db, "Failed Queue App");
    await insertActiveSource(db, appId);

    mockWorkflowBinding.createBatch.mockRejectedValueOnce(new Error("batch unavailable"));
    mockWorkflowBinding.create.mockRejectedValueOnce(new Error("create unavailable"));

    const worker = createWorkerInstance();
    const event = { scheduledTime: TEST_NOW.getTime(), cron: "*/15 * * * *" } as ScheduledEvent;
    await worker.scheduled(event);

    const pollRun = await latestPollRun(db);
    expect(pollRun).toBeDefined();
    expect(pollRun!.status).toBe("failed");
    expect(pollRun!.errorMessage).toContain("failed to queue");

    const failure = await db
      .select()
      .from(jobFailures)
      .where(sql`${jobFailures.jobType} = 'poll_sources' and ${jobFailures.jobKey} = 'scheduled'`)
      .get();
    expect(failure?.status).toBe("open");
    expect(failure?.errorMessage).toContain("failed to queue");
  });
});
