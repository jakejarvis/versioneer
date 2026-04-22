import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createDb, generateId, idPrefixes, sources, sourceFetches } from "@versioneer/db";

import PipelineWorker from "../index";

const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");
const TEST_NOW_ISO = TEST_NOW.toISOString();

function createWorkerInstance() {
  const instance = Object.create(PipelineWorker.prototype);
  instance.env = env;
  instance.ctx = {
    waitUntil: vi.fn<(promise: Promise<unknown>) => void>(),
    passThroughOnException: vi.fn<() => void>(),
  };
  return instance as InstanceType<typeof PipelineWorker>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
});

describe("recomputeLatest RPC", () => {
  it("executes without error for a valid app", async () => {
    const db = createDb(env.DB);
    const { apps } = await import("@versioneer/db");

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `rpc-recompute-${appId.slice(-8)}`,
      canonicalName: "Recompute Test",
      status: "public",
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    const worker = createWorkerInstance();
    // Should not throw — even with no releases, recompute handles empty state
    await expect(worker.recomputeLatest({ appId })).resolves.toBeUndefined();
  });
});

describe("reparse RPC", () => {
  it("executes parse then recompute for a valid source fetch", async () => {
    const db = createDb(env.DB);
    const { apps } = await import("@versioneer/db");

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `rpc-reparse-${appId.slice(-8)}`,
      canonicalName: "Reparse Test",
      status: "public",
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    const sourceId = generateId(idPrefixes.source);
    await db.insert(sources).values({
      id: sourceId,
      appId,
      sourceType: "sparkle",
      parserKey: "sparkle",
      reviewStatus: "approved",
      status: "active",
      pollIntervalMinutes: 60,
      ordinal: 0,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    const fetchId = generateId(idPrefixes.sourceFetch);
    await db.insert(sourceFetches).values({
      id: fetchId,
      sourceId,
      fetchStatus: "success",
      r2Key: "raw/test-fetch.xml",
      fetchedAt: TEST_NOW_ISO,
    });

    // Put a minimal body in R2 so the parser doesn't fail on missing content
    await env.RAW_BUCKET.put("raw/test-fetch.xml", "<rss></rss>");

    const worker = createWorkerInstance();
    // Reparse should execute without throwing — the parser may find no releases
    // but the pipeline handles that gracefully
    await expect(worker.reparse({ sourceFetchId: fetchId })).resolves.toBeUndefined();
  });
});
