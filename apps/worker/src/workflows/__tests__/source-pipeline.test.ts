import { env } from "cloudflare:workers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createDb, generateId, idPrefixes, sources } from "@versioneer/db";

import { SourcePipelineWorkflow } from "../source-pipeline";

function createWorkflowInstance() {
  const instance = Object.create(SourcePipelineWorkflow.prototype);
  instance.env = env;
  instance.ctx = {
    waitUntil: vi.fn<(promise: Promise<unknown>) => void>(),
    passThroughOnException: vi.fn<() => void>(),
  };
  return instance as InstanceType<typeof SourcePipelineWorkflow>;
}

function createMockStep() {
  const calls: string[] = [];
  return {
    calls,
    do: vi
      .fn<(name: string, options: unknown, callback: () => Promise<unknown>) => Promise<unknown>>()
      .mockImplementation(async (name, _options, callback) => {
        calls.push(name);
        return callback();
      }),
    sleep: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    sleepUntil: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("SourcePipelineWorkflow", () => {
  it("runs fetch step and exits early when source returns 304 Not Modified", async () => {
    const db = createDb(env.DB);
    const { apps } = await import("@versioneer/db");

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `wf-test-${appId.slice(-8)}`,
      canonicalName: "Workflow Test",
      status: "public",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });

    // Mock fetch to return 304 Not Modified — the pipeline treats this as "nothing to parse"
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 304 }));

    const workflow = createWorkflowInstance();
    const step = createMockStep();
    const event = {
      payload: { sourceId, reason: "scheduled" as const, force: false },
      timestamp: new Date(),
    };

    const result = await workflow.run(event as never, step as never);

    expect(step.calls).toContain("fetch-source");
    expect(result).toHaveProperty("status", "completed");
    // 304 means nothing new → shouldParse=false → early exit, no parse or recompute steps
    expect(step.calls).not.toContain("parse-source");
  });

  it("runs all 3 steps when source returns new content", async () => {
    const db = createDb(env.DB);
    const { apps } = await import("@versioneer/db");

    const appId = generateId(idPrefixes.app);
    await db.insert(apps).values({
      id: appId,
      slug: `wf-full-${appId.slice(-8)}`,
      canonicalName: "Full Pipeline App",
      status: "public",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
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
    const event = {
      payload: { sourceId, reason: "scheduled" as const, force: false },
      timestamp: new Date(),
    };

    const result = await workflow.run(event as never, step as never);

    // All 3 steps should have run
    expect(step.calls).toEqual(["fetch-source", "parse-source", "recompute-latest"]);
    expect(result).toHaveProperty("status", "completed");
    expect(result).toHaveProperty("releaseCount");
  });
});
