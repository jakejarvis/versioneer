import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import app from "../../index";

describe("POST /v1/attest/challenge", () => {
  it("returns a base64 challenge", async () => {
    const res = await app.request("/v1/attest/challenge", { method: "POST" }, env);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challenge: string };
    expect(body.challenge).toBeDefined();
    expect(typeof body.challenge).toBe("string");
    // Verify it was stored in KV
    const stored = await env.CACHE_KV.get(`attest:challenge:${body.challenge}`);
    expect(stored).toBe("1");
  });
});

describe("POST /v1/attest", () => {
  it("returns 400 for expired or missing challenge", async () => {
    const res = await app.request(
      "/v1/attest",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyId: "test-key-id",
          attestation: "fake-attestation-data",
          challenge: "nonexistent-challenge",
        }),
      },
      env,
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Challenge");
  });
});

describe("POST /v1/attest/refresh", () => {
  it("returns 404 for unknown device", async () => {
    // First create a valid challenge
    const challengeRes = await app.request("/v1/attest/challenge", { method: "POST" }, env);
    const { challenge } = (await challengeRes.json()) as { challenge: string };

    const res = await app.request(
      "/v1/attest/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyId: "unknown-device-key",
          assertion: "fake-assertion-data",
          challenge,
        }),
      },
      env,
    );
    expect(res.status).toBe(404);
  });
});
