import { env } from "cloudflare:workers";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { createDb, generateId, idPrefixes, inventoryIngestionJobs } from "@versioneer/db";

import {
  INVENTORY_INGESTION_HEARTBEAT_INTERVAL_MS,
  createInventoryIngestionHeartbeat,
} from "../inventory-ingestion-heartbeat";

const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");
const TEST_NOW_ISO = TEST_NOW.toISOString();
const TEST_OLD_ISO = new Date(TEST_NOW.getTime() - 5 * 60 * 1000).toISOString();

async function insertRunningJob(db: ReturnType<typeof createDb>) {
  const id = generateId(idPrefixes.inventoryIngestionJob);
  await db.insert(inventoryIngestionJobs).values({
    id,
    status: "running",
    payloadR2Key: `inventory-ingestions/test/${id}.json`,
    workflowInstanceId: `${id}-1`,
    attemptCount: 1,
    itemsTotal: 1,
    createdAt: TEST_OLD_ISO,
    updatedAt: TEST_OLD_ISO,
    queuedAt: TEST_OLD_ISO,
    startedAt: TEST_OLD_ISO,
  });
  return id;
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
  const db = createDb(env.DB);
  await db.delete(inventoryIngestionJobs).where(sql`1 = 1`);
});

describe("inventory ingestion heartbeat", () => {
  it("updates running jobs at most once per heartbeat interval", async () => {
    const db = createDb(env.DB);
    const ingestionId = await insertRunningJob(db);
    const heartbeat = createInventoryIngestionHeartbeat({ db, ingestionId });

    await heartbeat();

    let job = await db
      .select({ updatedAt: inventoryIngestionJobs.updatedAt })
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, ingestionId))
      .get();
    expect(job?.updatedAt).toBe(TEST_NOW_ISO);

    vi.advanceTimersByTime(INVENTORY_INGESTION_HEARTBEAT_INTERVAL_MS - 1);
    await heartbeat();

    job = await db
      .select({ updatedAt: inventoryIngestionJobs.updatedAt })
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, ingestionId))
      .get();
    expect(job?.updatedAt).toBe(TEST_NOW_ISO);

    vi.advanceTimersByTime(1);
    await heartbeat();

    job = await db
      .select({ updatedAt: inventoryIngestionJobs.updatedAt })
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, ingestionId))
      .get();
    expect(job?.updatedAt).toBe(new Date(TEST_NOW.getTime() + 30_000).toISOString());
  });
});
