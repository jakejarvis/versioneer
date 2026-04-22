import { env } from "cloudflare:workers";
import { describe, expect, it } from "vite-plus/test";

import { createDb, deviceAttestations } from "@versioneer/db";

import { markAssertionCounterUsed } from "../attest";

const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");

describe("App Attest assertion counter replay protection", () => {
  it("rejects counters that do not advance the stored counter", async () => {
    const db = createDb(env.DB);
    const suffix = crypto.randomUUID();
    const keyId = `key_replay_${suffix}`;
    const deviceId = `dev_replay_${suffix}`;
    await db.insert(deviceAttestations).values({
      id: deviceId,
      keyId,
      publicKey: "stored-public-key",
      counter: 7,
      receipt: null,
      environment: "production",
      createdAt: TEST_NOW.toISOString(),
      lastUsedAt: TEST_NOW.toISOString(),
    });

    await expect(markAssertionCounterUsed(db, deviceId, 7, TEST_NOW.toISOString())).resolves.toBe(
      false,
    );
    await expect(markAssertionCounterUsed(db, deviceId, 8, TEST_NOW.toISOString())).resolves.toBe(
      true,
    );
  });
});
