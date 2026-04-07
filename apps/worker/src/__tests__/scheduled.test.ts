import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDb, generateId, idPrefixes, sources } from "@versioneer/db";

// Import the default export — it's a WorkerEntrypoint class
import PipelineWorker from "../index";

// Stub SOURCE_PIPELINE so `scheduled()` doesn't trigger real workflow instances
// (which run in separate miniflare isolates and produce uncaught exceptions).
const mockWorkflowBinding = {
  create: vi.fn<() => Promise<{ id: string }>>().mockResolvedValue({ id: "wf_mock" }),
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

describe("scheduled handler", () => {
  afterEach(() => {
    mockWorkflowBinding.create.mockClear();
  });

  it("polls overdue sources and logs a cron job run", async () => {
    const db = createDb(env.DB);
    const { apps } = await import("@versioneer/db");

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `sched-test-${appId.slice(-8)}`,
      canonicalName: "Scheduled Test App",
      status: "public",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(sources).values({
      id: generateId(idPrefixes.source),
      appId,
      sourceType: "sparkle",
      parserKey: "sparkle",
      baseUrl: "https://test-scheduled.example.com/appcast.xml",
      reviewStatus: "approved",
      role: "authority",
      status: "active",
      pollIntervalMinutes: 15,
      ordinal: 0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const worker = createWorkerInstance();
    const event = { scheduledTime: Date.now(), cron: "*/15 * * * *" } as ScheduledEvent;
    await worker.scheduled(event);

    const { cronJobRuns } = await import("@versioneer/db");
    const runs = await db.select().from(cronJobRuns).all();
    const pollRun = runs.find((r) => r.jobType === "poll_sources");
    expect(pollRun).toBeDefined();
    expect(pollRun!.status).toBe("completed");
    expect(pollRun!.itemsTotal).toBeGreaterThanOrEqual(1);
  });

  it("skips sources that are not yet due", async () => {
    const db = createDb(env.DB);
    const { apps } = await import("@versioneer/db");

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `sched-fresh-${appId.slice(-8)}`,
      canonicalName: "Fresh App",
      status: "public",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    await db.insert(sources).values({
      id: generateId(idPrefixes.source),
      appId,
      sourceType: "sparkle",
      parserKey: "sparkle",
      reviewStatus: "approved",
      status: "active",
      pollIntervalMinutes: 60,
      ordinal: 0,
      lastFetchedAt: new Date().toISOString(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    const worker = createWorkerInstance();
    const event = { scheduledTime: Date.now(), cron: "*/15 * * * *" } as ScheduledEvent;
    await worker.scheduled(event);

    const { cronJobRuns } = await import("@versioneer/db");
    const { desc } = await import("drizzle-orm");
    const runs = await db.select().from(cronJobRuns).orderBy(desc(cronJobRuns.startedAt)).all();
    const pollRun = runs.find((r) => r.jobType === "poll_sources");
    expect(pollRun).toBeDefined();
    expect(pollRun!.status).toBe("completed");
  });
});
