import { env, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import type { EnrichmentDrainJob } from "@versioneer/core/pipeline";
import {
  createDb,
  cronJobRuns,
  discoveredApps,
  generateId,
  idPrefixes,
  jobFailures,
} from "@versioneer/db";

import { listEnrichmentCandidates, summarizeEnrichmentWorkflowError } from "../enrichment";
import { EnrichmentDrainWorkflow } from "../workflows/enrichment-drain";

const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");
const TEST_NOW_ISO = TEST_NOW.toISOString();

function createWorkflowInstance() {
  const instance = Object.create(EnrichmentDrainWorkflow.prototype);
  instance.env = env;
  instance.ctx = {
    waitUntil: vi.fn<(promise: Promise<unknown>) => void>(),
    passThroughOnException: vi.fn<() => void>(),
  };
  return instance as EnrichmentDrainWorkflow;
}

type MockWorkflowStep = WorkflowStep & { outputs: Map<string, unknown> };

function createStep(): MockWorkflowStep {
  const outputs = new Map<string, unknown>();
  const step = {
    outputs,
    do: vi.fn<
      (_name: string, optionsOrCallback: unknown, maybeCallback?: unknown) => Promise<unknown>
    >(async (name: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
      const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
      const output = await (callback as () => Promise<unknown>)();
      outputs.set(name, output);
      return output;
    }),
  };
  return step as unknown as MockWorkflowStep;
}

async function insertRun(db: ReturnType<typeof createDb>, runId: string) {
  await db.insert(cronJobRuns).values({
    id: runId,
    jobType: "enrich_discovered_apps",
    trigger: "manual",
    status: "running",
    actorId: "admin@example.com",
    startedAt: TEST_NOW_ISO,
  });
}

async function insertDiscoveredApp(db: ReturnType<typeof createDb>, index: number) {
  const id = generateId(idPrefixes.discoveredApp);
  await db.insert(discoveredApps).values({
    id,
    lookupKey: `enrichment-drain-${index}-${id}`,
    appName: `Drain App ${index}`,
    bundleId: `com.example.drain-${index}`,
    teamId: "TEAMID",
    status: "pending",
    enrichmentStatus: "pending",
    codeSigningAuthority: "Developer ID Application: Example Corp (TEAMID)",
    firstSeenAt: TEST_NOW_ISO,
    lastSeenAt: TEST_NOW_ISO,
    createdAt: TEST_NOW_ISO,
    updatedAt: TEST_NOW_ISO,
  });
  return id;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
  const db = createDb(env.DB);
  await db.delete(jobFailures).where(sql`1 = 1`);
  await db.delete(cronJobRuns).where(sql`1 = 1`);
  await db.delete(discoveredApps).where(sql`lookup_key like 'enrichment-drain-%'`);
});

describe("EnrichmentDrainWorkflow", () => {
  it("uses the mocked Worker clock for failed enrichment retry backoff", async () => {
    const db = createDb(env.DB);
    const id = await insertDiscoveredApp(db, 1);
    await db
      .update(discoveredApps)
      .set({
        enrichmentStatus: "failed",
        enrichmentError: "try again later",
        updatedAt: TEST_NOW_ISO,
      })
      .where(eq(discoveredApps.id, id));

    expect(await listEnrichmentCandidates(db)).toEqual([]);

    vi.setSystemTime(new Date(TEST_NOW.getTime() + 16 * 60 * 1000));
    expect(await listEnrichmentCandidates(db)).toEqual([{ id }]);
  });

  it("drains multiple eligible batches and resolves the mirrored failure", async () => {
    const db = createDb(env.DB);
    const runId = generateId(idPrefixes.cronJobRun);
    await insertRun(db, runId);
    for (let index = 0; index < 125; index++) {
      await insertDiscoveredApp(db, index);
    }
    await db.insert(jobFailures).values({
      id: generateId(idPrefixes.jobFailure),
      jobType: "enrich_discovered_apps",
      jobKey: "manual",
      relatedId: null,
      errorMessage: "previous failure",
      retryCount: 0,
      status: "open",
      createdAt: TEST_NOW_ISO,
      resolvedAt: null,
    });

    const workflow = createWorkflowInstance();
    const event = { payload: { runId, trigger: "manual" } } as WorkflowEvent<EnrichmentDrainJob>;
    const step = createStep();
    await workflow.run(event, step);

    const firstBatchOutput = step.outputs.get("enrich-discoveries-1");
    expect(firstBatchOutput).toMatchObject({
      candidateCount: 25,
      attempted: 25,
      succeeded: 25,
      failed: 0,
    });
    expect(firstBatchOutput).not.toHaveProperty("attemptedIds");
    expect(JSON.stringify(firstBatchOutput).length).toBeLessThan(1024);

    const run = await db.select().from(cronJobRuns).where(eq(cronJobRuns.id, runId)).get();
    expect(run?.status).toBe("completed");
    expect(run?.itemsTotal).toBe(125);
    expect(run?.itemsQueued).toBe(125);

    const openFailure = await db
      .select()
      .from(jobFailures)
      .where(
        sql`${jobFailures.jobType} = 'enrich_discovered_apps' and ${jobFailures.status} = 'open'`,
      )
      .get();
    expect(openFailure).toBeUndefined();
  });

  it("marks the run failed and mirrors a job failure when a workflow step throws", async () => {
    const db = createDb(env.DB);
    const runId = generateId(idPrefixes.cronJobRun);
    await insertRun(db, runId);
    await insertDiscoveredApp(db, 1);

    const workflow = createWorkflowInstance();
    const step = {
      do: vi.fn<() => Promise<unknown>>(async () => {
        throw new Error("workflow unavailable");
      }),
    } as unknown as WorkflowStep;
    const event = { payload: { runId, trigger: "manual" } } as WorkflowEvent<EnrichmentDrainJob>;

    await expect(workflow.run(event, step)).rejects.toThrow("workflow unavailable");

    const run = await db.select().from(cronJobRuns).where(eq(cronJobRuns.id, runId)).get();
    expect(run?.status).toBe("failed");
    expect(run?.errorMessage).toBe("workflow unavailable");

    const failure = await db
      .select()
      .from(jobFailures)
      .where(
        sql`${jobFailures.jobType} = 'enrich_discovered_apps' and ${jobFailures.jobKey} = 'manual'`,
      )
      .get();
    expect(failure?.status).toBe("open");
    expect(failure?.errorMessage).toBe("workflow unavailable");
  });

  it("keeps workflow-facing enrichment errors bounded", () => {
    const longError = "x".repeat(10_000);

    const summary = summarizeEnrichmentWorkflowError(longError);

    expect(summary.length).toBeLessThan(600);
    expect(summary.endsWith("...")).toBe(true);
  });
});
