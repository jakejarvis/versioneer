import { zValidator } from "@hono/zod-validator";
import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sign } from "hono/jwt";

import { verifyAttestation, verifyAssertion } from "@/lib/app-attest";
import { requireSecret } from "@/lib/env";
import { captureApiEvent } from "@/lib/observability";
import { attestRequestSchema, attestRefreshRequestSchema } from "@versioneer/core/validation";
import { createDb, deviceAttestations, generateId, idPrefixes } from "@versioneer/db";

const JWT_EXPIRY_SECONDS = 24 * 60 * 60; // 24 hours
const CHALLENGE_TTL_SECONDS = 300; // 5 minutes

function challengeKey(challenge: string): string {
  return `attest:challenge:${challenge}`;
}

async function consumeChallenge(kv: KVNamespace, challenge: string): Promise<void> {
  const stored = await kv.get(challengeKey(challenge));
  if (!stored) {
    throw new HTTPException(400, { message: "Challenge expired or already used" });
  }
  await kv.delete(challengeKey(challenge));
}

async function issueToken(
  secret: string,
  deviceId: string,
): Promise<{ token: string; deviceId: string; expiresAt: string }> {
  const exp = Math.floor(Date.now() / 1000) + JWT_EXPIRY_SECONDS;
  const token = await sign({ sub: deviceId, exp }, secret);
  return { token, deviceId, expiresAt: new Date(exp * 1000).toISOString() };
}

export async function markAssertionCounterUsed(
  db: ReturnType<typeof createDb>,
  deviceId: string,
  newCounter: number,
  now: string,
): Promise<boolean> {
  const updated = await db
    .update(deviceAttestations)
    .set({ counter: newCounter, lastUsedAt: now })
    .where(and(eq(deviceAttestations.id, deviceId), lt(deviceAttestations.counter, newCounter)))
    .returning({ id: deviceAttestations.id });

  return updated.length > 0;
}

export const attestRoutes = new Hono<{ Bindings: Env }>()
  // POST /v1/attest/challenge — generate a one-time challenge
  .post("/attest/challenge", async (c) => {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]!);
    }
    const challenge = btoa(binary);

    await c.env.CACHE_KV.put(challengeKey(challenge), "1", {
      expirationTtl: CHALLENGE_TTL_SECONDS,
    });

    return c.json({ challenge });
  })

  // POST /v1/attest — verify attestation, store device key, return JWT
  .post("/attest", zValidator("json", attestRequestSchema), async (c) => {
    const { keyId, attestation, challenge } = c.req.valid("json");

    await consumeChallenge(c.env.CACHE_KV, challenge);

    let result;
    try {
      result = await verifyAttestation(attestation, keyId, challenge);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Attestation verification failed";
      captureApiEvent(c, "client_attestation_failed", {
        target_type: "device_attestation",
        status: "failed",
      });
      throw new HTTPException(400, { message });
    }

    if (result.environment === "development" && c.env.ENVIRONMENT === "production") {
      captureApiEvent(c, "client_attestation_failed", {
        target_type: "device_attestation",
        status: "rejected",
        attestation_environment: result.environment,
      });
      throw new HTTPException(403, {
        message: "Development attestations not accepted in production",
      });
    }

    const db = createDb(c.env.DB);
    const id = generateId(idPrefixes.deviceAttestation);
    const now = new Date().toISOString();
    const upsertFields = {
      publicKey: result.publicKey,
      counter: result.counter,
      receipt: result.receipt,
      environment: result.environment,
      lastUsedAt: now,
    };

    const [device] = await db
      .insert(deviceAttestations)
      .values({ id, keyId, createdAt: now, ...upsertFields })
      .onConflictDoUpdate({ target: deviceAttestations.keyId, set: upsertFields })
      .returning({ id: deviceAttestations.id });

    if (!device) {
      throw new HTTPException(500, { message: "Failed to persist attestation" });
    }

    captureApiEvent(c, "client_attestation_succeeded", {
      target_type: "device_attestation",
      target_id: device.id,
      status: "succeeded",
      attestation_environment: result.environment,
    });

    return c.json(await issueToken(requireSecret(c.env), device.id));
  })

  // POST /v1/attest/refresh — verify assertion, issue new JWT
  .post("/attest/refresh", zValidator("json", attestRefreshRequestSchema), async (c) => {
    const { keyId, assertion, challenge } = c.req.valid("json");

    await consumeChallenge(c.env.CACHE_KV, challenge);

    const db = createDb(c.env.DB);
    const [device] = await db
      .select()
      .from(deviceAttestations)
      .where(eq(deviceAttestations.keyId, keyId))
      .limit(1);

    if (!device) {
      throw new HTTPException(404, { message: "Device not found" });
    }

    let result;
    try {
      result = await verifyAssertion(assertion, challenge, device.publicKey, device.counter);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Assertion verification failed";
      captureApiEvent(c, "client_attestation_failed", {
        target_type: "device_attestation",
        target_id: device.id,
        status: "failed",
      });
      throw new HTTPException(403, { message });
    }

    // Conditional counter update prevents replay: only succeeds if counter < newCounter
    const now = new Date().toISOString();
    if (!(await markAssertionCounterUsed(db, device.id, result.newCounter, now))) {
      captureApiEvent(c, "client_attestation_failed", {
        target_type: "device_attestation",
        target_id: device.id,
        status: "replay_detected",
      });
      throw new HTTPException(409, { message: "Assertion replay detected" });
    }

    captureApiEvent(c, "client_attestation_succeeded", {
      target_type: "device_attestation",
      target_id: device.id,
      status: "refreshed",
    });

    return c.json(await issueToken(requireSecret(c.env), device.id));
  });
