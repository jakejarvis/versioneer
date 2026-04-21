import { env } from "cloudflare:workers";
import { sign } from "hono/jwt";
import { beforeEach, describe, expect, it, vi } from "vitest";

import app from "../../index";

const TEST_SECRET = "test-jwt-secret-for-attestation";
const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
});

/**
 * Helper to make a request to a protected route.
 * The /v1/feedback route is behind requireAttestation.
 */
function protectedRequest(
  headers: Record<string, string> = {},
  envOverrides: Record<string, unknown> = {},
) {
  return app.request(
    "/v1/feedback",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: JSON.stringify({ feedbackType: "general" }),
    },
    { ...env, ...envOverrides } as Env,
  );
}

describe("requireAttestation middleware", () => {
  it("bypasses in dev environment", async () => {
    // Default env has ENVIRONMENT=dev — should pass through
    const res = await protectedRequest();
    expect(res.status).toBe(200);
  });

  it("bypasses when REQUIRE_ATTESTATION is false", async () => {
    const res = await protectedRequest(
      {},
      {
        ENVIRONMENT: "production",
        REQUIRE_ATTESTATION: "false",
        JWT_SECRET: TEST_SECRET,
      },
    );
    expect(res.status).toBe(200);
  });

  it("returns 401 for missing Authorization header", async () => {
    const res = await protectedRequest(
      {},
      {
        ENVIRONMENT: "production",
        REQUIRE_ATTESTATION: "true",
        JWT_SECRET: TEST_SECRET,
      },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Missing");
  });

  it("returns 401 for malformed Authorization header", async () => {
    const res = await protectedRequest(
      { Authorization: "NotBearer xyz" },
      {
        ENVIRONMENT: "production" as Env["ENVIRONMENT"],
        REQUIRE_ATTESTATION: "true" as string,
        JWT_SECRET: TEST_SECRET,
      },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain("Malformed");
  });

  it("returns 401 for invalid JWT", async () => {
    const res = await protectedRequest(
      { Authorization: "Bearer totally.invalid.token" },
      {
        ENVIRONMENT: "production" as Env["ENVIRONMENT"],
        REQUIRE_ATTESTATION: "true" as string,
        JWT_SECRET: TEST_SECRET,
      },
    );
    expect(res.status).toBe(401);
  });

  it("passes through with a valid JWT", async () => {
    const token = await sign(
      { sub: "device_123", exp: Math.floor(TEST_NOW.getTime() / 1000) + 3600 },
      TEST_SECRET,
    );
    const res = await protectedRequest(
      { Authorization: `Bearer ${token}` },
      {
        ENVIRONMENT: "production" as Env["ENVIRONMENT"],
        REQUIRE_ATTESTATION: "true" as string,
        JWT_SECRET: TEST_SECRET,
      },
    );
    expect(res.status).toBe(200);
  });
});
