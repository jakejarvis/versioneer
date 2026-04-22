import { env, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { inventoryMatchSnapshotKey } from "@versioneer/core/cache";
import type {
  InventoryFollowupPayload,
  InventoryFollowupWorkflowPayload,
} from "@versioneer/core/pipeline";
import {
  apps,
  catalogSuggestions,
  createDb,
  discoveredApps,
  generateId,
  idPrefixes,
  inventoryFollowupJobs,
  jobFailures,
  sources,
  suggestionEvidence,
} from "@versioneer/db";

import { InventoryFollowupWorkflow } from "../inventory-followup";

const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");
const TEST_NOW_ISO = TEST_NOW.toISOString();
const TEST_ICON_BASE64 = btoa("workflow-icon");

type MockWorkflowStep = WorkflowStep & { calls: string[] };

function createWorkflowInstance() {
  const instance = Object.create(InventoryFollowupWorkflow.prototype);
  instance.env = env;
  instance.ctx = {
    waitUntil: vi.fn<(promise: Promise<unknown>) => void>(),
    passThroughOnException: vi.fn<() => void>(),
  };
  return instance as InventoryFollowupWorkflow;
}

function createStep(): MockWorkflowStep {
  const calls: string[] = [];
  const step = Object.create(null);
  step.calls = calls;
  step.do = vi.fn<
    (name: string, optionsOrCallback: unknown, maybeCallback?: unknown) => Promise<unknown>
  >(async (name: string, optionsOrCallback: unknown, maybeCallback?: unknown) => {
    calls.push(name);
    const callback = typeof optionsOrCallback === "function" ? optionsOrCallback : maybeCallback;
    return (callback as () => Promise<unknown>)();
  });
  step.sleep = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  step.sleepUntil = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  step.waitForEvent = vi.fn<() => Promise<never>>();
  return step as MockWorkflowStep;
}

async function insertCatalogApp(db: ReturnType<typeof createDb>) {
  const appId = generateId(idPrefixes.app);
  await db.insert(apps).values({
    id: appId,
    slug: `inventory-followup-${appId.slice(-8)}`,
    canonicalName: "Inventory Follow-up Test",
    vendorName: "Versioneer",
    homepageUrl: "https://example.com",
    status: "public",
    createdAt: TEST_NOW_ISO,
    updatedAt: TEST_NOW_ISO,
  });

  await db.insert(sources).values({
    id: generateId(idPrefixes.source),
    appId,
    sourceType: "sparkle",
    parserKey: "sparkle",
    baseUrl: "https://updates.example.com/appcast.xml",
    reviewStatus: "approved",
    role: "authority",
    status: "active",
    pollIntervalMinutes: 60,
    ordinal: 0,
    createdAt: TEST_NOW_ISO,
    updatedAt: TEST_NOW_ISO,
  });

  return appId;
}

async function insertDiscoveredApp(db: ReturnType<typeof createDb>) {
  const discoveredAppId = generateId(idPrefixes.discoveredApp);
  await db.insert(discoveredApps).values({
    id: discoveredAppId,
    lookupKey: `bid:com.example.discovered.${discoveredAppId.slice(-8)}`,
    appName: "Discovered Follow-up Test",
    bundleId: `com.example.discovered.${discoveredAppId.slice(-8)}`,
    status: "pending",
    enrichmentStatus: "pending",
    sightingCount: 1,
    firstSeenAt: TEST_NOW_ISO,
    lastSeenAt: TEST_NOW_ISO,
    createdAt: TEST_NOW_ISO,
    updatedAt: TEST_NOW_ISO,
  });
  return discoveredAppId;
}

function createPayload(params: {
  appId: string;
  discoveredAppId: string;
}): InventoryFollowupPayload {
  return {
    version: 1,
    processedAt: TEST_NOW_ISO,
    discoveredIconCandidates: [
      {
        discoveredAppId: params.discoveredAppId,
        lookupKey: "bid:com.example.discovered",
        iconBase64: TEST_ICON_BASE64,
      },
    ],
    matchedAppCandidates: [
      {
        appId: params.appId,
        lookupKey: "bid:com.example.workflow",
        createSuggestions: true,
        iconBase64: TEST_ICON_BASE64,
        bundleId: "com.example.workflow",
        teamId: "TEAMID1234",
        sparkleFeedUrl: "https://updates.example.com/appcast.xml",
        sparklePublicKey: "sparkle-public-key",
        isMasApp: false,
        masAppId: null,
        electronUpdateProvider: "generic",
        electronUpdateUrl: "https://updates.example.com/latest.yml",
        homebrewCaskToken: "workflow-test",
      },
    ],
  };
}

async function insertFollowupJob(
  db: ReturnType<typeof createDb>,
  payload: InventoryFollowupPayload,
) {
  const jobId = generateId(idPrefixes.inventoryFollowupJob);
  const payloadR2Key = `inventory-followups/test/${jobId}.json`;
  await env.RAW_BUCKET.put(payloadR2Key, JSON.stringify(payload));
  await db.insert(inventoryFollowupJobs).values({
    id: jobId,
    status: "queued",
    payloadR2Key,
    attemptCount: 1,
    itemsTotal: payload.discoveredIconCandidates.length + payload.matchedAppCandidates.length,
    createdAt: TEST_NOW_ISO,
    updatedAt: TEST_NOW_ISO,
    queuedAt: TEST_NOW_ISO,
  });
  return { jobId, payloadR2Key };
}

async function runWorkflow(jobId: string) {
  const workflow = createWorkflowInstance();
  const step = createStep();
  const event: WorkflowEvent<InventoryFollowupWorkflowPayload> = {
    payload: { jobId },
    timestamp: TEST_NOW,
    instanceId: `${jobId}-1`,
  };
  const result = await workflow.run(event, step);
  return { result, step };
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
  const db = createDb(env.DB);
  await db.delete(jobFailures).where(sql`1 = 1`);
  await db.delete(inventoryFollowupJobs).where(sql`1 = 1`);
  await env.CACHE_KV.delete(inventoryMatchSnapshotKey());
});

describe("InventoryFollowupWorkflow", () => {
  it("stores icons, invalidates inventory cache, creates suggestions, and completes the job", async () => {
    const db = createDb(env.DB);
    const appId = await insertCatalogApp(db);
    const discoveredAppId = await insertDiscoveredApp(db);
    const payload = createPayload({ appId, discoveredAppId });
    const { jobId, payloadR2Key } = await insertFollowupJob(db, payload);
    await env.CACHE_KV.put(inventoryMatchSnapshotKey(), JSON.stringify({ appsById: {} }));

    const { result, step } = await runWorkflow(jobId);

    expect(result).toHaveProperty("status", "completed");
    expect(step.calls).toEqual([
      "load-followup-payload",
      "store-discovered-icons",
      "store-catalog-icons",
      "create-suggestions",
      "mark-completed",
    ]);

    const job = await db
      .select()
      .from(inventoryFollowupJobs)
      .where(eq(inventoryFollowupJobs.id, jobId))
      .get();
    expect(job?.status).toBe("completed");
    expect(job?.itemsTotal).toBe(2);
    expect(job?.itemsSucceeded).toBe(2);
    expect(job?.itemsFailed).toBe(0);
    expect(await env.RAW_BUCKET.get(payloadR2Key)).toBeNull();

    const discovered = await db
      .select({ iconR2Key: discoveredApps.iconR2Key })
      .from(discoveredApps)
      .where(eq(discoveredApps.id, discoveredAppId))
      .get();
    expect(discovered?.iconR2Key).toMatch(/^icons\/[0-9a-f]{12}\.png$/);

    const app = await db
      .select({ iconR2Key: apps.iconR2Key })
      .from(apps)
      .where(eq(apps.id, appId))
      .get();
    expect(app?.iconR2Key).toMatch(/^icons\/[0-9a-f]{12}\.png$/);
    expect(await env.ASSETS_BUCKET.get(app!.iconR2Key!)).not.toBeNull();
    expect(await env.CACHE_KV.get(inventoryMatchSnapshotKey())).toBeNull();

    const suggestions = await db
      .select()
      .from(catalogSuggestions)
      .where(eq(catalogSuggestions.appId, appId))
      .all();
    expect(suggestions.length).toBeGreaterThanOrEqual(6);
    expect(new Set(suggestions.map((suggestion) => suggestion.queueType))).toEqual(
      new Set(["metadata_change", "new_source"]),
    );

    const evidence = await db
      .select()
      .from(suggestionEvidence)
      .where(eq(suggestionEvidence.appId, appId))
      .all();
    expect(evidence).toHaveLength(suggestions.length);
  });

  it("can process the same payload twice without duplicating suggestions or evidence", async () => {
    const db = createDb(env.DB);
    const appId = await insertCatalogApp(db);
    const discoveredAppId = await insertDiscoveredApp(db);
    const payload = createPayload({ appId, discoveredAppId });

    await runWorkflow((await insertFollowupJob(db, payload)).jobId);
    const suggestionCount = (
      await db.select().from(catalogSuggestions).where(eq(catalogSuggestions.appId, appId)).all()
    ).length;
    const evidenceCount = (
      await db.select().from(suggestionEvidence).where(eq(suggestionEvidence.appId, appId)).all()
    ).length;

    await runWorkflow((await insertFollowupJob(db, payload)).jobId);

    expect(
      (await db.select().from(catalogSuggestions).where(eq(catalogSuggestions.appId, appId)).all())
        .length,
    ).toBe(suggestionCount);
    expect(
      (await db.select().from(suggestionEvidence).where(eq(suggestionEvidence.appId, appId)).all())
        .length,
    ).toBe(evidenceCount);
  });

  it("marks the job failed and preserves the payload when durable state is invalid", async () => {
    const db = createDb(env.DB);
    const jobId = generateId(idPrefixes.inventoryFollowupJob);
    const payloadR2Key = `inventory-followups/test/${jobId}.json`;
    await db.insert(inventoryFollowupJobs).values({
      id: jobId,
      status: "queued",
      payloadR2Key,
      attemptCount: 1,
      itemsTotal: 1,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
      queuedAt: TEST_NOW_ISO,
    });

    await expect(runWorkflow(jobId)).rejects.toThrow("does not exist");

    const job = await db
      .select()
      .from(inventoryFollowupJobs)
      .where(eq(inventoryFollowupJobs.id, jobId))
      .get();
    expect(job?.status).toBe("failed");
    expect(job?.errorMessage).toContain(payloadR2Key);

    const failure = await db
      .select()
      .from(jobFailures)
      .where(eq(jobFailures.relatedId, jobId))
      .get();
    expect(failure?.jobType).toBe("inventory_followup");
    expect(failure?.jobKey).toBe("workflow");
  });
});
