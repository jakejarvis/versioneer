import { env, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { handleSourceFetch, type SourceFetchJob } from "@versioneer/core/pipeline";
import { normalizeVersion } from "@versioneer/core/versioning";
import { createDb, generateId, idPrefixes, sourceFetches, sources } from "@versioneer/db";

import { SourcePipelineWorkflow } from "../source-pipeline";

const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");
const TEST_NOW_ISO = TEST_NOW.toISOString();

function createWorkflowInstance() {
  const instance = Object.create(SourcePipelineWorkflow.prototype);
  instance.env = {
    ...env,
    resolveSourceHostAddresses: async () => ["93.184.216.34"],
  };
  instance.ctx = {
    waitUntil: vi.fn<(promise: Promise<unknown>) => void>(),
    passThroughOnException: vi.fn<() => void>(),
  };
  return instance as InstanceType<typeof SourcePipelineWorkflow>;
}

type MockWorkflowStep = WorkflowStep & { calls: string[] };

function createMockStep(): MockWorkflowStep {
  const calls: string[] = [];
  const step = Object.create(null);
  step.calls = calls;
  step.do = vi
    .fn<(name: string, options: unknown, callback: () => Promise<unknown>) => Promise<unknown>>()
    .mockImplementation(async (name, _options, callback) => {
      calls.push(name);
      return callback();
    });
  step.sleep = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  step.sleepUntil = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  step.waitForEvent = vi.fn<() => Promise<never>>();
  return step as MockWorkflowStep;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SourcePipelineWorkflow", () => {
  it("blocks unsafe source URLs before fetching and records failure metadata", async () => {
    const db = createDb(env.DB);
    const { apps } = await import("@versioneer/db");

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `wf-blocked-${appId.slice(-8)}`,
      canonicalName: "Blocked Fetch Test",
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
      baseUrl: "http://localhost/appcast.xml",
      reviewStatus: "approved",
      status: "active",
      pollIntervalMinutes: 60,
      ordinal: 0,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(
      handleSourceFetch(
        { sourceId, reason: "test", force: false },
        {
          ...env,
          resolveSourceHostAddresses: async () => ["127.0.0.1"],
        },
      ),
    ).rejects.toThrow("Source fetch only allows https URLs");

    expect(fetchSpy).not.toHaveBeenCalledWith("http://localhost/appcast.xml", expect.anything());
    const rows = await db
      .select()
      .from(sourceFetches)
      .where(eq(sourceFetches.sourceId, sourceId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fetchStatus).toBe("error");
    expect(rows[0]!.fetchHostname).toBe("localhost");
    expect(rows[0]!.fetchScheme).toBe("http");
    expect(rows[0]!.failureReason).toBe("non_https");

    const updatedSource = await db.select().from(sources).where(eq(sources.id, sourceId)).get();
    expect(updatedSource?.lastFailureAt).toBe(TEST_NOW_ISO);
  });

  it("runs fetch step and exits early when source returns 304 Not Modified", async () => {
    const db = createDb(env.DB);
    const { apps } = await import("@versioneer/db");

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `wf-test-${appId.slice(-8)}`,
      canonicalName: "Workflow Test",
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
      baseUrl: "https://test-sparkle.example.com/appcast.xml",
      reviewStatus: "approved",
      status: "active",
      pollIntervalMinutes: 60,
      ordinal: 0,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    // Mock fetch to return 304 Not Modified — the pipeline treats this as "nothing to parse"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 304 }));

    const workflow = createWorkflowInstance();
    const step = createMockStep();
    const event: WorkflowEvent<SourceFetchJob> = {
      payload: { sourceId, reason: "scheduled" as const, force: false },
      timestamp: TEST_NOW,
      instanceId: `wf_304_${sourceId}`,
    };

    const result = await workflow.run(event, step);

    expect(step.calls).toContain("fetch-source");
    expect(result).toHaveProperty("status", "completed");
    // 304 means nothing new → shouldParse=false → early exit, no parse or recompute steps
    expect(step.calls).not.toContain("parse-source");
  });

  it("uses the workflow instance id as a stable source fetch idempotency seed", async () => {
    const db = createDb(env.DB);
    const { apps } = await import("@versioneer/db");

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `wf-idempotent-${appId.slice(-8)}`,
      canonicalName: "Idempotent Workflow Test",
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
      baseUrl: "https://test-sparkle.example.com/idempotent-appcast.xml",
      reviewStatus: "approved",
      status: "active",
      pollIntervalMinutes: 60,
      ordinal: 0,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 304 }));
    const event: WorkflowEvent<SourceFetchJob> = {
      payload: { sourceId, reason: "scheduled" as const, force: false },
      timestamp: TEST_NOW,
      instanceId: `wf_retry_${sourceId}`,
    };

    const workflow = createWorkflowInstance();
    const firstStep = createMockStep();
    const secondStep = createMockStep();

    await workflow.run(event, firstStep);
    await workflow.run(event, secondStep);

    const rows = await db
      .select()
      .from(sourceFetches)
      .where(eq(sourceFetches.sourceId, sourceId))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.fetchStatus).toBe("not_modified");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("runs all 3 steps when source returns new content", async () => {
    const db = createDb(env.DB);
    const { apps, artifacts, jobFailures, releases } = await import("@versioneer/db");

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `wf-full-${appId.slice(-8)}`,
      canonicalName: "Full Pipeline App",
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
      baseUrl: "https://test-sparkle.example.com/full-appcast.xml",
      reviewStatus: "approved",
      status: "active",
      pollIntervalMinutes: 60,
      ordinal: 0,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });
    const priorReleaseId = generateId(idPrefixes.release);
    await db.insert(releases).values({
      id: priorReleaseId,
      appId,
      versionRaw: "1.0.0",
      versionNormalized: normalizeVersion("1.0.0"),
      channel: "stable",
      status: "active",
      isPrerelease: false,
      publishedBySourceId: sourceId,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });
    await db.insert(artifacts).values({
      id: generateId(idPrefixes.artifact),
      releaseId: priorReleaseId,
      artifactType: "dmg",
      url: "https://old-artifacts.example.com/app-1.0.0.dmg",
      sha256: "abc123",
      isPrimary: true,
      createdAt: TEST_NOW_ISO,
    });

    // Mock fetch to return a minimal Sparkle appcast with one release
    const appcastXml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Full Pipeline App</title>
    <item>
      <title>Version 2.0.0</title>
      <sparkle:version>2.0.0</sparkle:version>
      <pubDate>Mon, 01 Jan 2026 00:00:00 +0000</pubDate>
      <description><![CDATA[
        <h2>Changes</h2>
        <ul><li>Added Markdown release notes</li></ul>
      ]]></description>
      <enclosure url="https://example.com/app-2.0.0.dmg" length="10000" type="application/octet-stream" />
    </item>
  </channel>
</rss>`;

    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(appcastXml, {
        status: 200,
        headers: { "content-type": "application/xml" },
      }),
    );

    const workflow = createWorkflowInstance();
    const step = createMockStep();
    const event: WorkflowEvent<SourceFetchJob> = {
      payload: { sourceId, reason: "scheduled" as const, force: false },
      timestamp: TEST_NOW,
      instanceId: `wf_full_${sourceId}`,
    };

    const result = await workflow.run(event, step);

    // All 3 steps should have run
    expect(step.calls).toEqual(["fetch-source", "parse-source", "recompute-latest"]);
    expect(result).toHaveProperty("status", "completed");
    expect(result).toHaveProperty("releaseCount");
    const anomalies = await db
      .select()
      .from(jobFailures)
      .where(eq(jobFailures.jobType, "source-anomaly"))
      .all();
    expect(
      anomalies.some(
        (row) => row.jobKey === "missing_install_hash:https://example.com/app-2.0.0.dmg",
      ),
    ).toBe(true);
    expect(anomalies.some((row) => row.jobKey === "new_artifact_hostname:example.com")).toBe(true);
    const parsedRelease = await db
      .select()
      .from(releases)
      .where(eq(releases.versionNormalized, normalizeVersion("2.0.0")))
      .get();
    expect(parsedRelease?.releaseNotesMarkdown).toContain("## Changes");
    expect(parsedRelease?.releaseNotesMarkdown).toContain("- Added Markdown release notes");
    expect(parsedRelease?.releaseNotesHtml).toBeNull();
  });
});
