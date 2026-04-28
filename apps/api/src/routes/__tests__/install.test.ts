import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";

import { installExecutions } from "@versioneer/db";

import { getDb, seedApp, seedArtifact, seedRelease, seedSource } from "../../__tests__/seed";
import app from "../../index";

const createExecutionBody = (
  appId: string,
  releaseId: string,
  artifactId?: string,
  overrides: Record<string, unknown> = {},
) => ({
  client: {
    platform: "macos",
    appVersion: "1.0.0",
    osVersion: "15.4",
    systemArchitecture: "arm64",
  },
  target: {
    appId,
    releaseId,
    artifactId: artifactId ?? null,
    targetArchitecture: "arm64",
  },
  install: {
    strategy: "dmg_copy_replace" as const,
    executionRoute: "local_replace" as const,
  },
  expected: {
    previousVersion: "0.9.0",
    bundleId: "com.example.test",
    teamId: "TEAM123456",
  },
  ...overrides,
});

describe("POST /v1/install/executions", () => {
  it("creates an install execution", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });
    const artifact = await seedArtifact(db, release.id, { architecture: "universal" });

    const res = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createExecutionBody(testApp.id, release.id, artifact.id)),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { execution: { id: string; status: string } };
    expect(body.execution.id).toMatch(/^exec_/);
    expect(body.execution.status).toBe("prepared");
  });

  it("returns 404 for nonexistent app", async () => {
    const res = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createExecutionBody("app_nonexistent", "rel_nonexistent")),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("rejects inactive releases", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, {
      publishedBySourceId: source.id,
      status: "withdrawn",
    });

    const res = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createExecutionBody(testApp.id, release.id)),
      },
      env,
    );
    expect(res.status).toBe(404);
  });

  it("rejects artifact-based installs without an artifact", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });

    const res = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createExecutionBody(testApp.id, release.id)),
      },
      env,
    );
    expect(res.status).toBe(400);
  });

  it("requires executionRoute when creating an install execution", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });

    const res = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...createExecutionBody(testApp.id, release.id),
          install: {
            strategy: "dmg_copy_replace",
          },
        }),
      },
      env,
    );

    expect(res.status).toBe(400);
  });

  it("rejects artifacts incompatible with the target architecture", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });
    const artifact = await seedArtifact(db, release.id, { architecture: "arm64" });

    const res = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          createExecutionBody(testApp.id, release.id, artifact.id, {
            client: {
              platform: "macos",
              appVersion: "1.0.0",
              osVersion: "15.4",
              systemArchitecture: "x86_64",
            },
            target: {
              appId: testApp.id,
              releaseId: release.id,
              artifactId: artifact.id,
              targetArchitecture: "x86_64",
            },
          }),
        ),
      },
      env,
    );

    expect(res.status).toBe(409);
  });

  it("accepts artifacts whose architecture compatibility is unknown", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });
    const artifact = await seedArtifact(db, release.id, { architecture: "unknown" });

    const res = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createExecutionBody(testApp.id, release.id, artifact.id)),
      },
      env,
    );

    expect(res.status).toBe(200);
  });
});

describe("POST /v1/install/executions/:id/events", () => {
  it("records a successful install", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });
    const artifact = await seedArtifact(db, release.id, { architecture: "universal" });

    // First, prepare
    const prepRes = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createExecutionBody(testApp.id, release.id, artifact.id)),
      },
      env,
    );
    const {
      execution: { id: executionId },
    } = (await prepRes.json()) as { execution: { id: string } };

    // Then report success
    const statusRes = await app.request(
      `/v1/install/executions/${executionId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            status: "succeeded",
            installedVersion: "1.0.0",
          },
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
    const body = (await statusRes.json()) as { execution: { id: string; status: string } };
    expect(body.execution.status).toBe("recorded");
  });

  it("records a failed install", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });
    const artifact = await seedArtifact(db, release.id, { architecture: "universal" });

    const prepRes = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createExecutionBody(testApp.id, release.id, artifact.id)),
      },
      env,
    );
    const {
      execution: { id: executionId },
    } = (await prepRes.json()) as { execution: { id: string } };

    const res = await app.request(
      `/v1/install/executions/${executionId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            status: "failed",
            errorMessage: "Signature verification failed",
          },
        }),
      },
      env,
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { execution: { status: string } };
    expect(body.execution.status).toBe("recorded");
  });

  it("does not overwrite terminal install executions", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });
    const artifact = await seedArtifact(db, release.id, { architecture: "universal" });

    const prepRes = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createExecutionBody(testApp.id, release.id, artifact.id)),
      },
      env,
    );
    const {
      execution: { id: executionId },
    } = (await prepRes.json()) as { execution: { id: string } };

    const successRes = await app.request(
      `/v1/install/executions/${executionId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            status: "succeeded",
            installedVersion: "1.0.0",
          },
        }),
      },
      env,
    );
    expect(successRes.status).toBe(200);

    const staleFailureRes = await app.request(
      `/v1/install/executions/${executionId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            status: "failed",
            errorMessage: "Signature verification failed",
          },
        }),
      },
      env,
    );
    expect(staleFailureRes.status).toBe(200);

    const row = await db
      .select({
        status: installExecutions.status,
        installedVersion: installExecutions.installedVersion,
        errorMessage: installExecutions.errorMessage,
      })
      .from(installExecutions)
      .where(eq(installExecutions.id, executionId))
      .get();
    expect(row?.status).toBe("succeeded");
    expect(row?.installedVersion).toBe("1.0.0");
    expect(row?.errorMessage).toBeNull();
  });

  it("redacts install error messages before persistence", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });
    const artifact = await seedArtifact(db, release.id, { architecture: "universal" });

    const prepRes = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createExecutionBody(testApp.id, release.id, artifact.id)),
      },
      env,
    );
    const {
      execution: { id: executionId },
    } = (await prepRes.json()) as { execution: { id: string } };

    const rawError =
      "Signature failed at /Users/jake/Downloads/Test.app token=ghp_secret12345 https://example.com/app.zip";
    const res = await app.request(
      `/v1/install/executions/${executionId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            status: "failed",
            errorMessage: rawError,
          },
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const row = await db
      .select({ errorMessage: installExecutions.errorMessage })
      .from(installExecutions)
      .where(eq(installExecutions.id, executionId))
      .get();
    expect(row?.errorMessage).toContain("Signature failed");
    expect(row?.errorMessage).toContain("[path]");
    expect(row?.errorMessage).toContain("[url]");
    expect(row?.errorMessage).toContain("token=[redacted]");
    expect(row?.errorMessage).not.toContain("/Users/jake");
    expect(row?.errorMessage).not.toContain("ghp_secret12345");
    expect(row?.errorMessage).not.toContain("https://example.com/app.zip");
  });

  it("records status updates for unknown-architecture artifacts", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db);
    const source = await seedSource(db, testApp.id);
    const release = await seedRelease(db, testApp.id, { publishedBySourceId: source.id });
    const artifact = await seedArtifact(db, release.id, { architecture: "unknown" });

    const prepRes = await app.request(
      "/v1/install/executions",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(createExecutionBody(testApp.id, release.id, artifact.id)),
      },
      env,
    );
    const {
      execution: { id: executionId },
    } = (await prepRes.json()) as { execution: { id: string } };

    const res = await app.request(
      `/v1/install/executions/${executionId}/events`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            status: "started",
          },
        }),
      },
      env,
    );

    expect(res.status).toBe(200);
    const body = (await res.json()) as { execution: { status: string } };
    expect(body.execution.status).toBe("recorded");
  });

  it("returns 404 when the execution does not exist", async () => {
    const res = await app.request(
      "/v1/install/executions/exec_missing/events",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: {
            status: "failed",
            errorMessage: "missing execution",
          },
        }),
      },
      env,
    );

    expect(res.status).toBe(404);
  });
});
