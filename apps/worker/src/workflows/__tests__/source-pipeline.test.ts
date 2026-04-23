import { env, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { getCachedLatest, setCachedLatest } from "@versioneer/core/cache";
import {
  buildArtifactIdentity,
  handleRecomputeLatest,
  handleSourceFetch,
  type SourceFetchJob,
} from "@versioneer/core/pipeline";
import { normalizeVersion } from "@versioneer/core/versioning";
import {
  appLatestReleases,
  apps,
  artifacts,
  createDb,
  generateId,
  idPrefixes,
  releases,
  releaseObservations,
  sourceFetches,
  sources,
} from "@versioneer/db";

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
    const { jobFailures } = await import("@versioneer/db");

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
      canonicalUrl: buildArtifactIdentity({
        url: "https://old-artifacts.example.com/app-1.0.0.dmg",
      }).canonicalUrl,
      identityKey: buildArtifactIdentity({
        url: "https://old-artifacts.example.com/app-1.0.0.dmg",
      }).identityKey,
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

  it("dedupes rotating signed artifact URLs into one artifact and one rolled-up observation", async () => {
    const db = createDb(env.DB);

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `wf-signed-${appId.slice(-8)}`,
      canonicalName: "Signed URL App",
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
      baseUrl: "https://downloads.example.com/appcast.xml",
      reviewStatus: "approved",
      status: "active",
      pollIntervalMinutes: 60,
      ordinal: 0,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    const firstSignedUrl =
      "https://binaries.example.com/145.2.7632.4581/comet_latest.dmg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=first";
    const secondSignedUrl =
      "https://binaries.example.com/145.2.7632.4581/comet_latest.dmg?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Expires=300&X-Amz-Signature=second";

    const firstAppcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <sparkle:version>145.2.7632.4581</sparkle:version>
      <enclosure url="${firstSignedUrl}" sparkle:edSignature="sig-1" />
    </item>
  </channel>
</rss>`;
    const secondAppcast = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <sparkle:version>145.2.7632.4581</sparkle:version>
      <enclosure url="${secondSignedUrl}" sparkle:edSignature="sig-1" />
    </item>
  </channel>
</rss>`;

    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(firstAppcast, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(secondAppcast, {
          status: 200,
          headers: { "content-type": "application/xml" },
        }),
      );

    const workflow = createWorkflowInstance();
    await workflow.run(
      {
        payload: { sourceId, reason: "scheduled" as const, force: false },
        timestamp: TEST_NOW,
        instanceId: `wf_signed_${sourceId}_1`,
      },
      createMockStep(),
    );
    await workflow.run(
      {
        payload: { sourceId, reason: "scheduled" as const, force: false },
        timestamp: TEST_NOW,
        instanceId: `wf_signed_${sourceId}_2`,
      },
      createMockStep(),
    );

    const release = await db.select().from(releases).where(eq(releases.appId, appId)).get();
    expect(release).toBeTruthy();

    const artifactRows = await db
      .select()
      .from(artifacts)
      .where(eq(artifacts.releaseId, release!.id))
      .all();
    expect(artifactRows).toHaveLength(1);
    expect(artifactRows[0]!.canonicalUrl).toBe(
      "https://binaries.example.com/145.2.7632.4581/comet_latest.dmg",
    );
    expect(artifactRows[0]!.identityKey).toBe(
      "url:https://binaries.example.com/145.2.7632.4581/comet_latest.dmg",
    );
    expect(artifactRows[0]!.url).toBe(secondSignedUrl);

    const observationRows = await db
      .select()
      .from(releaseObservations)
      .where(eq(releaseObservations.releaseId, release!.id))
      .all();
    expect(observationRows).toHaveLength(1);
    expect(observationRows[0]!.observedDownloadUrl).toBe(
      "https://binaries.example.com/145.2.7632.4581/comet_latest.dmg",
    );
    expect(observationRows[0]!.seenCount).toBe(2);
  });

  it("clears latest rows and cache for channels without active releases", async () => {
    const db = createDb(env.DB);

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `wf-stale-latest-${appId.slice(-8)}`,
      canonicalName: "Stale Latest App",
      status: "public",
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    const stableReleaseId = generateId(idPrefixes.release);
    await db.insert(releases).values({
      id: stableReleaseId,
      appId,
      versionRaw: "2.0.0",
      versionNormalized: normalizeVersion("2.0.0"),
      channel: "stable",
      status: "active",
      isPrerelease: false,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });
    const stableArtifactId = generateId(idPrefixes.artifact);
    await db.insert(artifacts).values({
      id: stableArtifactId,
      releaseId: stableReleaseId,
      artifactType: "dmg",
      url: "https://example.com/stale-latest-2.0.0.dmg",
      canonicalUrl: buildArtifactIdentity({
        url: "https://example.com/stale-latest-2.0.0.dmg",
      }).canonicalUrl,
      identityKey: buildArtifactIdentity({
        url: "https://example.com/stale-latest-2.0.0.dmg",
      }).identityKey,
      architecture: "universal",
      isPrimary: true,
      createdAt: TEST_NOW_ISO,
    });

    const betaReleaseId = generateId(idPrefixes.release);
    await db.insert(releases).values({
      id: betaReleaseId,
      appId,
      versionRaw: "3.0.0-beta",
      versionNormalized: normalizeVersion("3.0.0-beta"),
      channel: "beta",
      status: "withdrawn",
      isPrerelease: true,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    await db.insert(appLatestReleases).values({
      id: generateId(idPrefixes.appLatestRelease),
      appId,
      channel: "beta",
      targetArchitecture: "arm64",
      releaseId: betaReleaseId,
      versionNormalized: normalizeVersion("3.0.0-beta"),
      versionRaw: "3.0.0-beta",
      updatedAt: TEST_NOW_ISO,
    });
    await setCachedLatest(env.CACHE_KV, {
      appId,
      channel: "beta",
      targetArchitecture: "arm64",
      releaseId: betaReleaseId,
      versionNormalized: normalizeVersion("3.0.0-beta"),
      versionRaw: "3.0.0-beta",
      releasedAt: null,
      updatedAt: TEST_NOW_ISO,
    });

    await handleRecomputeLatest({ appId }, env);

    const latestRows = await db
      .select({
        channel: appLatestReleases.channel,
        targetArchitecture: appLatestReleases.targetArchitecture,
        releaseId: appLatestReleases.releaseId,
      })
      .from(appLatestReleases)
      .where(eq(appLatestReleases.appId, appId))
      .all();
    expect(latestRows.some((row) => row.channel === "beta")).toBe(false);
    expect(
      latestRows.some(
        (row) =>
          row.channel === "stable" &&
          row.targetArchitecture === "arm64" &&
          row.releaseId === stableReleaseId,
      ),
    ).toBe(true);
    expect(await getCachedLatest(env.CACHE_KV, appId, "beta", "arm64")).toBeNull();
  });

  it("normalizes latest release timestamps during recompute", async () => {
    const db = createDb(env.DB);

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `wf-latest-date-${appId.slice(-8)}`,
      canonicalName: "Latest Date App",
      status: "public",
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    const releaseId = generateId(idPrefixes.release);
    await db.insert(releases).values({
      id: releaseId,
      appId,
      versionRaw: "2.0.0",
      versionNormalized: normalizeVersion("2.0.0"),
      channel: "stable",
      releasedAt: "Wed, 11 Feb 2026 06:36:00 +0000",
      status: "active",
      isPrerelease: false,
      createdAt: TEST_NOW_ISO,
      updatedAt: TEST_NOW_ISO,
    });

    await handleRecomputeLatest({ appId, channel: "stable" }, env);

    const latest = await db
      .select()
      .from(appLatestReleases)
      .where(eq(appLatestReleases.appId, appId))
      .get();
    expect(latest?.releasedAt).toBe("2026-02-11T06:36:00.000Z");

    const release = await db.select().from(releases).where(eq(releases.id, releaseId)).get();
    expect(release?.releasedAt).toBe("2026-02-11T06:36:00.000Z");

    const cached = await getCachedLatest(env.CACHE_KV, appId, "stable", "arm64");
    expect(cached?.releasedAt).toBe("2026-02-11T06:36:00.000Z");
  });
});
