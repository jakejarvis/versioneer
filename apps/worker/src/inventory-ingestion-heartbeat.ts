import { and, eq } from "drizzle-orm";

import { createDb, inventoryIngestionJobs } from "@versioneer/db";

type Db = ReturnType<typeof createDb>;

export const INVENTORY_INGESTION_HEARTBEAT_INTERVAL_MS = 30 * 1000;

export async function touchInventoryIngestionJob(params: {
  db: Db;
  ingestionId: string;
  now?: string;
}) {
  const now = params.now ?? new Date().toISOString();
  await params.db
    .update(inventoryIngestionJobs)
    .set({ updatedAt: now })
    .where(
      and(
        eq(inventoryIngestionJobs.id, params.ingestionId),
        eq(inventoryIngestionJobs.status, "running"),
      ),
    );
}

export function createInventoryIngestionHeartbeat(params: {
  db: Db;
  ingestionId: string;
  minIntervalMs?: number;
  now?: () => Date;
}) {
  const minIntervalMs = params.minIntervalMs ?? INVENTORY_INGESTION_HEARTBEAT_INTERVAL_MS;
  let lastHeartbeatAt = 0;

  return async () => {
    const now = params.now?.() ?? new Date();
    const nowMs = now.getTime();
    if (nowMs - lastHeartbeatAt < minIntervalMs) {
      return;
    }

    lastHeartbeatAt = nowMs;
    await touchInventoryIngestionJob({
      db: params.db,
      ingestionId: params.ingestionId,
      now: now.toISOString(),
    });
  };
}
