import { zValidator } from "@hono/zod-validator";
import { attestRequestSchema, attestRefreshRequestSchema } from "@versioneer/core/validation";
import { createDb, deviceAttestations, generateId, idPrefixes } from "@versioneer/db";
import { and, eq, lt } from "drizzle-orm";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { sign } from "hono/jwt";

import { verifyAttestation, verifyAssertion } from "@/lib/app-attest";

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

export const attestRoutes = new Hono<{ Bindings: Env }>()

  // GET /v1/attest/challenge — generate a one-time challenge
  .get("/attest/challenge", async (c) => {
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
      throw new HTTPException(400, { message });
    }

    const db = createDb(c.env.DB);
    const id = generateId(idPrefixes.deviceAttestation);
    const now = new Date().toISOString();

    await db.insert(deviceAttestations).values({
      id,
      keyId,
      publicKey: result.publicKey,
      counter: result.counter,
      receipt: result.receipt,
      environment: result.environment,
      createdAt: now,
      lastUsedAt: now,
    });

    return c.json(await issueToken(c.env.JWT_SECRET!, id));
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
      throw new HTTPException(403, { message });
    }

    // Conditional counter update prevents replay: only succeeds if counter < newCounter
    const now = new Date().toISOString();
    const updated = await db
      .update(deviceAttestations)
      .set({ counter: result.newCounter, lastUsedAt: now })
      .where(
        and(
          eq(deviceAttestations.id, device.id),
          lt(deviceAttestations.counter, result.newCounter),
        ),
      )
      .returning({ id: deviceAttestations.id });

    if (updated.length === 0) {
      throw new HTTPException(409, { message: "Assertion replay detected" });
    }

    return c.json(await issueToken(c.env.JWT_SECRET!, device.id));
  });
