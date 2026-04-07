import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { getDb, seedApp, seedArtifact, seedRelease, seedSource } from "../../__tests__/seed";
import app from "../../index";

const prepareBody = (appId: string, releaseId: string, artifactId?: string) => ({
  client: {
    platform: "macos",
    appVersion: "1.0.0",
    osVersion: "15.4",
    systemArchitecture: "arm64",
  },
  appId,
  releaseId,
  artifactId: artifactId ?? null,
  installStrategy: "dmg_copy_replace" as const,
  executionRoute: "local_replace" as const,
  previousVersion: "0.9.0",
  bundleId: "com.example.test",
  teamId: "TEAM123456",
});

describe("POST /v1/install/prepare", () => {
  it("creates an install execution", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });

    const res = await app.request(
      "/v1/install/prepare",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prepareBody(testApp.id, release.id)),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { executionId: string; status: string };
    expect(body.executionId).toMatch(/^exec_/);
    expect(body.status).toBe("prepared");
  });

  it("returns 404 for nonexistent app", async () => {
    const res = await app.request(
      "/v1/install/prepare",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prepareBody("app_nonexistent", "rel_nonexistent")),
      },
      env,
    );
    expect(res.status).toBe(404);
  });
});

describe("POST /v1/install/executions/:id/status", () => {
  it("records a successful install", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });
    const artifact = await seedArtifact(db, release.id);

    // First, prepare
    const prepRes = await app.request(
      "/v1/install/prepare",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(prepareBody(testApp.id, release.id, artifact.id)),
      },
      env,
    );
    const { executionId } = (await prepRes.json()) as { executionId: string };

    // Then report success
    const statusRes = await app.request(
      `/v1/install/executions/${executionId}/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...prepareBody(testApp.id, release.id, artifact.id),
          status: "succeeded",
          installedVersion: "1.0.0",
          verification: {
            strategy: "dmg_copy_replace",
            executionRoute: "local_replace",
            hashVerified: true,
            signatureVerified: true,
            notarizationVerified: true,
            bundleIdMatch: true,
            teamIdMatch: true,
            observedBundleId: "com.example.test",
            observedTeamId: "TEAM123456",
            observedVersion: "1.0.0",
          },
        }),
      },
      env,
    );
    expect(statusRes.status).toBe(200);
    const body = (await statusRes.json()) as { executionId: string; status: string };
    expect(body.status).toBe("recorded");
  });

  it("records a failed install", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });

    const res = await app.request(
      `/v1/install/executions/exec_new123/status`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...prepareBody(testApp.id, release.id),
          status: "failed",
          errorMessage: "Signature verification failed",
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe("recorded");
  });
});
