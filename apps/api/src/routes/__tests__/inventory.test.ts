import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";

import { inventoryMatchSnapshotKey } from "@versioneer/core/cache";
import {
  inventoryIngestionPayloadSchema,
  type InventoryIngestionQueueMessage,
} from "@versioneer/core/pipeline";
import { normalizeVersion } from "@versioneer/core/versioning";
import { discoveredApps, inventoryIngestionJobs, jobFailures } from "@versioneer/db";

import {
  getDb,
  seedAlias,
  seedApp,
  seedArtifact,
  seedLatestRelease,
  seedRelease,
  seedSource,
} from "../../__tests__/seed";
import app from "../../index";
import { MAX_INVENTORY_GZIP_BYTES, MAX_INVENTORY_JSON_BYTES } from "../../lib/constants";
import { seedInventoryCatalog } from "./fixtures/inventory-seed";

type InventoryResponse = {
  results: Array<{
    app: {
      name: string;
      bundleId: string | null;
      installedVersion: string | null;
    };
    decision: string;
    catalog: {
      match: {
        appId: string | null;
        appName: string | null;
        confidence: number | null;
      };
      trackingState: string;
      localReasonCode: string | null;
      iconUrl: string | null;
      staleSince: string | null;
    };
    release: {
      version: string | null;
      versionRaw: string | null;
      releaseId: string | null;
      releasedAt: string | null;
      targetArchitecture: string | null;
      artifact: {
        id: string;
        downloadUrl: string;
        architecture: string | null;
        artifactType: string | null;
      } | null;
    };
    install: {
      strategy: string | null;
      homebrewCaskToken?: string | null;
      trust: {
        status: "one_click" | "manual_only" | "external" | "none";
        resolvedStrategy: string | null;
        reasons: string[];
      };
    };
    channels: {
      selected: string | null;
      available: string[];
    };
  }>;
  issues: {
    invalidApps: Array<{ index: number; appName: string | null; reasons: string[] }>;
  };
  processedAt: string;
};

async function postInventoryRequest(
  init: { body: BodyInit; headers?: HeadersInit },
  extraEnv?: Partial<Env>,
) {
  const ctx = createExecutionContext();
  const res = await app.request(
    "/v1/inventory/check",
    {
      method: "POST",
      headers: { "Content-Type": "application/json", ...init.headers },
      body: init.body,
    },
    { ...env, ...extraEnv },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

async function postInventory(
  body: { client: Record<string, unknown>; apps: unknown[]; scanDurationMs?: number },
  extraEnv?: Partial<Env>,
) {
  return postInventoryRequest({ body: JSON.stringify(body) }, extraEnv);
}

async function readInventoryResponse(res: Response): Promise<InventoryResponse> {
  return (await res.json()) as InventoryResponse;
}

async function gzipText(text: string): Promise<ArrayBuffer> {
  return new Response(
    new Blob([text]).stream().pipeThrough(new CompressionStream("gzip")),
  ).arrayBuffer();
}

async function selectDiscoveredByLookupKeys(lookupKeys: string[]) {
  const db = getDb(env.DB);
  const rows = [];
  for (let i = 0; i < lookupKeys.length; i += 100) {
    rows.push(
      ...(await db
        .select({
          lookupKey: discoveredApps.lookupKey,
          appName: discoveredApps.appName,
          bundleId: discoveredApps.bundleId,
          sightingCount: discoveredApps.sightingCount,
        })
        .from(discoveredApps)
        .where(inArray(discoveredApps.lookupKey, lookupKeys.slice(i, i + 100)))
        .all()),
    );
  }
  return rows;
}

let catalog: Awaited<ReturnType<typeof seedInventoryCatalog>>;
const TEST_NOW = new Date("2026-03-31T12:00:00.000Z");
const TEST_ICON_BASE64 = btoa("test-icon");

function createInventoryIngestionQueueMock() {
  const send = vi.fn<(message: InventoryIngestionQueueMessage) => Promise<QueueSendResponse>>(
    async () => ({
      metadata: { metrics: { backlogCount: 0, backlogBytes: 0 } },
    }),
  );
  return {
    queue: { send } as unknown as Queue<InventoryIngestionQueueMessage>,
    send,
  };
}

beforeAll(async () => {
  const db = getDb(env.DB);
  catalog = await seedInventoryCatalog(db);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
  return env.CACHE_KV.delete(inventoryMatchSnapshotKey());
});

describe("POST /v1/inventory/check", () => {
  it("returns empty results for empty apps array", async () => {
    const res = await postInventory({ client: {}, apps: [] });
    expect(res.status).toBe(200);
    const body = await readInventoryResponse(res);
    expect(body.results).toEqual([]);
    expect(body.processedAt).toBeDefined();
  });

  it("accepts gzip-compressed inventory JSON", async () => {
    const body = JSON.stringify({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [{ appName: "Firefox", bundleId: "org.mozilla.firefox", version: "130.0" }],
    });
    const res = await postInventoryRequest({
      headers: { "Content-Encoding": "gzip" },
      body: await gzipText(body),
    });

    expect(res.status).toBe(200);
    const responseBody = await readInventoryResponse(res);
    expect(responseBody.results[0]!.decision).toBe("up_to_date");
  });

  it("rejects raw inventory bodies over the decoded JSON limit", async () => {
    const res = await postInventoryRequest({
      headers: { "Content-Length": String(MAX_INVENTORY_JSON_BYTES + 1) },
      body: "{}",
    });

    expect(res.status).toBe(413);
  });

  it("rejects gzip inventory bodies over the compressed limit", async () => {
    const res = await postInventoryRequest({
      headers: {
        "Content-Encoding": "gzip",
        "Content-Length": String(MAX_INVENTORY_GZIP_BYTES + 1),
      },
      body: await gzipText(JSON.stringify({ client: {}, apps: [] })),
    });

    expect(res.status).toBe(413);
  });

  it("rejects gzip inventory bodies over the decoded JSON limit", async () => {
    const body = JSON.stringify({
      client: {},
      apps: [],
      padding: "x".repeat(MAX_INVENTORY_JSON_BYTES),
    });
    const res = await postInventoryRequest({
      headers: { "Content-Encoding": "gzip" },
      body: await gzipText(body),
    });

    expect(res.status).toBe(413);
  });

  it("rejects invalid gzip inventory bodies", async () => {
    const res = await postInventoryRequest({
      headers: { "Content-Encoding": "gzip" },
      body: "not gzip",
    });

    expect(res.status).toBe(400);
  });

  it("rejects malformed inventory JSON", async () => {
    const res = await postInventoryRequest({ body: "{" });

    expect(res.status).toBe(400);
  });

  it("rejects unsupported inventory content encodings", async () => {
    const res = await postInventoryRequest({
      headers: { "Content-Encoding": "br" },
      body: JSON.stringify({ client: {}, apps: [] }),
    });

    expect(res.status).toBe(415);
  });

  it("matches an app by bundle_id — up to date", async () => {
    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [{ appName: "Firefox", bundleId: "org.mozilla.firefox", version: "130.0" }],
    });
    expect(res.status).toBe(200);
    const body = await readInventoryResponse(res);
    expect(body.results).toHaveLength(1);
    const result = body.results[0]!;
    expect(result.decision).toBe("up_to_date");
    expect(result.catalog.trackingState).toBe("public");
    expect(result.catalog.match.appId).toBe(catalog.appA.id);
    expect(result.release.version).toBe("130.0");
    expect(result.release.targetArchitecture).toBe("arm64");
    expect(result.release.artifact).not.toBeNull();
    expect(result.install.strategy).toBeNull();
    expect(result.install.trust.status).toBe("none");
    expect(result.install.homebrewCaskToken).toBe("firefox");
    expect(result.catalog.localReasonCode).toBeNull();
    expect(await env.CACHE_KV.get(inventoryMatchSnapshotKey())).not.toBeNull();
  });

  it("matches an app by bundle_id — update available", async () => {
    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [
        {
          appName: "Firefox",
          bundleId: "org.mozilla.firefox",
          teamId: "MOZILLA123",
          version: "120.0",
        },
      ],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("update_available");
    expect(result.release.version).toBe("130.0");
    expect(result.install.strategy).toBe("dmg_copy_replace");
    expect(result.install.trust).toEqual({
      status: "one_click",
      resolvedStrategy: "dmg_copy_replace",
      reasons: [],
    });
  });

  it("keeps update visibility but suppresses one-click install when trust material is missing", async () => {
    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [{ appName: "Firefox", bundleId: "org.mozilla.firefox", version: "120.0" }],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("update_available");
    expect(result.release.version).toBe("130.0");
    expect(result.release.artifact?.downloadUrl).toBe(
      "https://download.mozilla.org/firefox-130.0.dmg",
    );
    expect(result.install.strategy).toBeNull();
    expect(result.install.trust.status).toBe("manual_only");
    expect(result.install.trust.reasons).toEqual(["missing_team_id"]);
  });

  it("keeps one-click install enabled when only the catalog hash is missing", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db, {
      canonicalName: "Hash Optional App",
      status: "public",
    });
    await seedAlias(db, testApp.id, {
      aliasType: "bundle_id",
      value: "com.example.hashoptional",
      normalizedValue: "com.example.hashoptional",
    });
    const source = await seedSource(db, testApp.id, {
      sourceType: "github_releases",
      parserKey: "github_releases",
      reviewStatus: "approved",
      role: "authority",
      status: "active",
      lastSuccessAt: TEST_NOW.toISOString(),
    });
    const release = await seedRelease(db, testApp.id, {
      versionRaw: "2.0.0",
      versionNormalized: normalizeVersion("2.0.0"),
      channel: "stable",
      status: "active",
      publishedBySourceId: source.id,
      releasedAt: "2026-03-12T00:00:00Z",
    });
    const artifact = await seedArtifact(db, release.id, {
      artifactType: "dmg",
      url: "https://example.com/hash-optional-2.0.0.dmg",
      architecture: "universal",
      sha256: null,
      isPrimary: true,
    });
    await seedLatestRelease(db, {
      appId: testApp.id,
      releaseId: release.id,
      authoritySourceId: source.id,
      artifactId: artifact.id,
      targetArchitecture: "arm64",
      versionNormalized: release.versionNormalized,
      versionRaw: release.versionRaw,
      releasedAt: release.releasedAt!,
      installStrategy: "dmg_copy_replace",
    });

    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [
        {
          appName: "Hash Optional App",
          bundleId: "com.example.hashoptional",
          teamId: "TEAM123456",
          version: "1.0.0",
        },
      ],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("update_available");
    expect(result.install.strategy).toBe("dmg_copy_replace");
    expect(result.install.trust).toEqual({
      status: "one_click",
      resolvedStrategy: "dmg_copy_replace",
      reasons: ["missing_sha256"],
    });
  });

  it("suppresses one-click install for non-HTTPS catalog artifacts", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db, {
      canonicalName: "Insecure Artifact App",
      status: "public",
    });
    await seedAlias(db, testApp.id, {
      aliasType: "bundle_id",
      value: "com.example.insecureartifact",
      normalizedValue: "com.example.insecureartifact",
    });
    const source = await seedSource(db, testApp.id, {
      sourceType: "github_releases",
      parserKey: "github_releases",
      reviewStatus: "approved",
      role: "authority",
      status: "active",
      lastSuccessAt: TEST_NOW.toISOString(),
    });
    const release = await seedRelease(db, testApp.id, {
      versionRaw: "2.0.0",
      versionNormalized: normalizeVersion("2.0.0"),
      channel: "stable",
      status: "active",
      publishedBySourceId: source.id,
      releasedAt: "2026-03-12T00:00:00Z",
    });
    const artifact = await seedArtifact(db, release.id, {
      artifactType: "dmg",
      url: "http://example.com/insecure-2.0.0.dmg",
      architecture: "universal",
      sha256: "securehash",
      isPrimary: true,
    });
    await seedLatestRelease(db, {
      appId: testApp.id,
      releaseId: release.id,
      authoritySourceId: source.id,
      artifactId: artifact.id,
      targetArchitecture: "arm64",
      versionNormalized: release.versionNormalized,
      versionRaw: release.versionRaw,
      releasedAt: release.releasedAt!,
      installStrategy: "dmg_copy_replace",
    });

    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [
        {
          appName: "Insecure Artifact App",
          bundleId: "com.example.insecureartifact",
          teamId: "TEAM123456",
          version: "1.0.0",
        },
      ],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("update_available");
    expect(result.release.artifact?.downloadUrl).toBe("http://example.com/insecure-2.0.0.dmg");
    expect(result.install.strategy).toBeNull();
    expect(result.install.trust).toEqual({
      status: "manual_only",
      resolvedStrategy: "dmg_copy_replace",
      reasons: ["missing_artifact"],
    });
  });

  it("keeps Sparkle installs enabled when the public key is not pre-approved", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db, {
      canonicalName: "Sparkle Key Optional App",
      status: "public",
    });
    await seedAlias(db, testApp.id, {
      aliasType: "bundle_id",
      value: "com.example.sparkleoptional",
      normalizedValue: "com.example.sparkleoptional",
    });
    const source = await seedSource(db, testApp.id, {
      sourceType: "sparkle",
      parserKey: "sparkle",
      reviewStatus: "approved",
      role: "authority",
      status: "active",
      lastSuccessAt: TEST_NOW.toISOString(),
    });
    const release = await seedRelease(db, testApp.id, {
      versionRaw: "5.0.0",
      versionNormalized: normalizeVersion("5.0.0"),
      channel: "stable",
      status: "active",
      publishedBySourceId: source.id,
      releasedAt: "2026-03-13T00:00:00Z",
    });
    await seedLatestRelease(db, {
      appId: testApp.id,
      releaseId: release.id,
      authoritySourceId: source.id,
      artifactId: null,
      targetArchitecture: "arm64",
      versionNormalized: release.versionNormalized,
      versionRaw: release.versionRaw,
      releasedAt: release.releasedAt!,
      installStrategy: "sparkle",
    });

    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [
        {
          appName: "Sparkle Key Optional App",
          bundleId: "com.example.sparkleoptional",
          version: "4.0.0",
        },
      ],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("update_available");
    expect(result.install.strategy).toBe("sparkle");
    expect(result.install.trust).toEqual({
      status: "one_click",
      resolvedStrategy: "sparkle",
      reasons: ["missing_sparkle_public_key"],
    });
  });

  it("marks Mac App Store catalog routes as external", async () => {
    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [
        {
          appName: "Sketch",
          bundleId: "com.bohemiancoding.sketch3",
          version: "99.0",
          isMasApp: true,
        },
      ],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("update_available");
    expect(result.install.strategy).toBeNull();
    expect(result.install.trust).toEqual({
      status: "external",
      resolvedStrategy: "mac_app_store",
      reasons: ["mac_app_store_external"],
    });
  });

  it("returns ambiguous when no installed version provided", async () => {
    const res = await postInventory({
      client: {},
      apps: [{ appName: "Firefox", bundleId: "org.mozilla.firefox" }],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("ambiguous");
  });

  it("returns local_only / not_found for unmatched app", async () => {
    const res = await postInventory({
      client: {},
      apps: [{ appName: "Unknown App", bundleId: "com.unknown.app" }],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("local_only");
    expect(result.catalog.trackingState).toBe("local_only");
    expect(result.catalog.localReasonCode).toBe("not_found");
    expect(result.catalog.match.appId).toBeNull();
  });

  it("returns local_only / matched_draft for draft app", async () => {
    const res = await postInventory({
      client: {},
      apps: [{ appName: "Draft App", bundleId: "com.example.draft", version: "1.0" }],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("local_only");
    expect(result.catalog.localReasonCode).toBe("matched_draft");
  });

  it("returns local_only / no_approved_source for app without sources", async () => {
    const res = await postInventory({
      client: {},
      apps: [{ appName: "No Source App", bundleId: "com.example.nosource", version: "1.0" }],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("local_only");
    expect(result.catalog.localReasonCode).toBe("no_approved_source");
  });

  it("returns incompatible when no target-architecture latest row exists", async () => {
    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "x86_64" },
      apps: [{ appName: "Sketch", bundleId: "com.bohemiancoding.sketch3", version: "99.0" }],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("incompatible");
    expect(result.catalog.trackingState).toBe("public");
    expect(result.catalog.localReasonCode).toBe("no_compatible_release");
    expect(result.release.targetArchitecture).toBe("x86_64");
  });

  it("returns incompatible when the latest artifact requires a newer OS", async () => {
    const res = await postInventory({
      client: { osVersion: "13.0", systemArchitecture: "arm64" },
      apps: [{ appName: "Sketch", bundleId: "com.bohemiancoding.sketch3", version: "99.0" }],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("incompatible");
    expect(result.catalog.localReasonCode).toBe("no_compatible_release");
  });

  it("uses the fallback artifact install strategy when latest is unusable", async () => {
    const db = getDb(env.DB);
    const testApp = await seedApp(db, {
      canonicalName: "Fallback Strategy App",
      status: "public",
    });
    await seedAlias(db, testApp.id, {
      aliasType: "bundle_id",
      value: "com.example.fallbackstrategy",
      normalizedValue: "com.example.fallbackstrategy",
    });
    const source = await seedSource(db, testApp.id, {
      sourceType: "github_releases",
      parserKey: "github_releases",
      reviewStatus: "approved",
      role: "authority",
      status: "active",
      lastSuccessAt: TEST_NOW.toISOString(),
    });
    const latestRelease = await seedRelease(db, testApp.id, {
      versionRaw: "3.0.0",
      versionNormalized: normalizeVersion("3.0.0"),
      channel: "stable",
      status: "active",
      publishedBySourceId: source.id,
      releasedAt: "2026-03-20T00:00:00Z",
    });
    const latestArtifact = await seedArtifact(db, latestRelease.id, {
      artifactType: "pkg",
      url: "https://example.com/fallback-3.0.0.pkg",
      architecture: "arm64",
      minOsVersion: "16.0",
      sha256: "pkghash",
    });
    const fallbackRelease = await seedRelease(db, testApp.id, {
      versionRaw: "2.0.0",
      versionNormalized: normalizeVersion("2.0.0"),
      channel: "stable",
      status: "active",
      publishedBySourceId: source.id,
      releasedAt: "2026-02-20T00:00:00Z",
    });
    const fallbackArtifact = await seedArtifact(db, fallbackRelease.id, {
      artifactType: "dmg",
      url: "https://example.com/fallback-2.0.0.dmg",
      architecture: "arm64",
      sha256: "dmghash",
    });
    await seedLatestRelease(db, {
      appId: testApp.id,
      releaseId: latestRelease.id,
      authoritySourceId: source.id,
      artifactId: latestArtifact.id,
      targetArchitecture: "arm64",
      versionNormalized: latestRelease.versionNormalized,
      versionRaw: latestRelease.versionRaw,
      releasedAt: latestRelease.releasedAt!,
      installStrategy: "pkg_install",
    });

    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [
        {
          appName: "Fallback Strategy App",
          bundleId: "com.example.fallbackstrategy",
          teamId: "TEAM123456",
          version: "1.0.0",
        },
      ],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.release.releaseId).toBe(fallbackRelease.id);
    expect(result.release.artifact?.id).toBe(fallbackArtifact.id);
    expect(result.release.artifact?.artifactType).toBe("dmg");
    expect(result.install.strategy).toBe("dmg_copy_replace");
    expect(result.install.trust.resolvedStrategy).toBe("dmg_copy_replace");
  });

  it("returns different latest compatible releases for split arm64 and x86 clients", async () => {
    const [armRes, x86Res] = await Promise.all([
      postInventory({
        client: { osVersion: "15.0", systemArchitecture: "arm64" },
        apps: [{ appName: "Split App", bundleId: "com.example.split", version: "2.0.0" }],
      }),
      postInventory({
        client: { osVersion: "15.0", systemArchitecture: "x86_64" },
        apps: [{ appName: "Split App", bundleId: "com.example.split", version: "2.0.0" }],
      }),
    ]);
    const armBody = await readInventoryResponse(armRes);
    const x86Body = await readInventoryResponse(x86Res);

    expect(armBody.results[0]!.release.version).toBe("3.0.0");
    expect(armBody.results[0]!.release.releaseId).toBe(catalog.releaseEArm.id);
    expect(armBody.results[0]!.release.targetArchitecture).toBe("arm64");
    expect(armBody.results[0]!.release.artifact?.architecture).toBe("arm64");

    expect(x86Body.results[0]!.release.version).toBe("2.5.0");
    expect(x86Body.results[0]!.release.releaseId).toBe(catalog.releaseEX86.id);
    expect(x86Body.results[0]!.release.targetArchitecture).toBe("x86_64");
    expect(x86Body.results[0]!.release.artifact?.architecture).toBe("x86_64");
  });

  it("keeps unknown-architecture updates installable while flagging degraded trust", async () => {
    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [
        {
          appName: "Unknown Arch App",
          bundleId: "com.example.unknownarch",
          teamId: "TEAM123456",
          version: "1.0.0",
        },
      ],
    });
    const body = await readInventoryResponse(res);
    const result = body.results[0]!;
    expect(result.decision).toBe("update_available");
    expect(result.release.releaseId).toBe(catalog.releaseF.id);
    expect(result.release.artifact?.architecture).toBe("unknown");
    expect(result.install.strategy).toBe("dmg_copy_replace");
    expect(result.install.trust).toEqual({
      status: "one_click",
      resolvedStrategy: "dmg_copy_replace",
      reasons: ["unknown_architecture"],
    });
  });

  it("reports invalid apps through issues.invalidApps", async () => {
    const res = await postInventory({
      client: {},
      apps: [
        { appName: "Valid App" },
        { appName: 123 }, // invalid: appName must be string
      ],
    });
    const body = await readInventoryResponse(res);
    expect(body.results).toHaveLength(1);
    expect(body.issues.invalidApps).toHaveLength(1);
    expect(body.issues.invalidApps![0]!.index).toBe(1);
    expect(body.issues.invalidApps![0]!.reasons.length).toBeGreaterThan(0);
  });

  it("persists unmatched apps to discoveredApps", async () => {
    const uniqueBundle = "com.test.discovered.single";
    const res = await postInventory({
      client: {},
      apps: [{ appName: "Brand New App", bundleId: uniqueBundle, version: "1.0.0" }],
    });
    expect(res.status).toBe(200);

    // Check DB for the discovered app
    const db = getDb(env.DB);
    const rows = await db
      .select()
      .from(discoveredApps)
      .where(eq(discoveredApps.lookupKey, `bid:${uniqueBundle.toLowerCase()}`))
      .all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.appName).toBe("Brand New App");
    expect(rows[0]!.bundleId).toBe(uniqueBundle);
  });

  it("creates a durable inventory ingestion payload, row, and queue message", async () => {
    const { queue, send } = createInventoryIngestionQueueMock();
    const uniqueBundle = "com.test.followup.payload";

    const res = await postInventory(
      {
        client: { osVersion: "15.0", systemArchitecture: "arm64" },
        apps: [
          {
            appName: "Follow-up Unknown",
            bundleId: uniqueBundle,
            version: "1.0.0",
            iconBase64: TEST_ICON_BASE64,
          },
          {
            appName: "Firefox",
            bundleId: "org.mozilla.firefox",
            teamId: "MOZILLA123",
            version: "130.0",
            iconBase64: TEST_ICON_BASE64,
          },
        ],
      },
      { INVENTORY_INGESTION_QUEUE: queue } as Partial<Env>,
    );
    expect(res.status).toBe(200);
    const body = await readInventoryResponse(res);
    expect(body.results).toHaveLength(2);

    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]![0];
    const job = await getDb(env.DB)
      .select()
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, message.ingestionId))
      .get();
    expect(job).toBeDefined();
    expect(job!.status).toBe("pending");
    expect(job!.attemptCount).toBe(0);
    expect(job!.payloadR2Key).toContain(message.ingestionId);

    const payloadObject = await env.RAW_BUCKET.get(job!.payloadR2Key);
    expect(payloadObject).not.toBeNull();
    const payload = inventoryIngestionPayloadSchema.parse(JSON.parse(await payloadObject!.text()));
    expect(payload.discoveredIconCandidates).toEqual([
      expect.objectContaining({
        lookupKey: `bid:${uniqueBundle}`,
        iconBase64: TEST_ICON_BASE64,
      }),
    ]);
    expect(payload.matchedAppCandidates).toEqual([
      expect.objectContaining({
        appId: catalog.appA.id,
        lookupKey: "bid:org.mozilla.firefox",
        createSuggestions: true,
        iconBase64: TEST_ICON_BASE64,
        teamId: "MOZILLA123",
      }),
    ]);
  });

  it("skips matched app icon payloads when the catalog already has an icon", async () => {
    const { queue, send } = createInventoryIngestionQueueMock();
    const db = getDb(env.DB);
    const iconApp = await seedApp(db, {
      canonicalName: "Icon Existing App",
      status: "public",
      iconR2Key: "icons/existing.png",
    });
    await seedAlias(db, iconApp.id, {
      aliasType: "bundle_id",
      value: "com.test.icon-existing",
      normalizedValue: "com.test.icon-existing",
    });
    const source = await seedSource(db, iconApp.id, {
      sourceType: "github_releases",
      parserKey: "github_releases",
      reviewStatus: "approved",
      role: "authority",
      status: "active",
      lastSuccessAt: TEST_NOW.toISOString(),
    });
    const release = await seedRelease(db, iconApp.id, {
      versionRaw: "2.0.0",
      versionNormalized: normalizeVersion("2.0.0"),
      channel: "stable",
      status: "active",
      publishedBySourceId: source.id,
    });
    const artifact = await seedArtifact(db, release.id, {
      artifactType: "dmg",
      url: "https://example.com/icon-existing.dmg",
      architecture: "universal",
      sha256: "iconhash",
    });
    await seedLatestRelease(db, {
      appId: iconApp.id,
      releaseId: release.id,
      authoritySourceId: source.id,
      artifactId: artifact.id,
      targetArchitecture: "arm64",
      versionNormalized: release.versionNormalized,
      versionRaw: release.versionRaw,
      installStrategy: "dmg_copy_replace",
    });

    const res = await postInventory(
      {
        client: { osVersion: "15.0", systemArchitecture: "arm64" },
        apps: [
          {
            appName: "Icon Existing App",
            bundleId: "com.test.icon-existing",
            version: "1.0.0",
            iconBase64: TEST_ICON_BASE64,
          },
        ],
      },
      { INVENTORY_INGESTION_QUEUE: queue } as Partial<Env>,
    );

    expect(res.status).toBe(200);
    expect(send).toHaveBeenCalledTimes(1);
    const message = send.mock.calls[0]![0];
    const job = await getDb(env.DB)
      .select()
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, message.ingestionId))
      .get();
    const payloadObject = await env.RAW_BUCKET.get(job!.payloadR2Key);
    const payload = inventoryIngestionPayloadSchema.parse(JSON.parse(await payloadObject!.text()));
    expect(payload.matchedAppCandidates).toEqual([
      expect.objectContaining({
        appId: iconApp.id,
        createSuggestions: true,
        iconBase64: null,
      }),
    ]);
  });

  it("returns the inventory response when background R2 payload persistence fails", async () => {
    const failingBucket = {
      put: vi.fn<() => Promise<void>>(async () => {
        throw new Error("r2 unavailable");
      }),
    } as unknown as R2Bucket;

    const res = await postInventory(
      {
        client: { osVersion: "15.0", systemArchitecture: "arm64" },
        apps: [
          {
            appName: "Firefox",
            bundleId: "org.mozilla.firefox",
            teamId: "R2FAIL",
            version: "130.0",
            iconBase64: TEST_ICON_BASE64,
          },
        ],
      },
      { RAW_BUCKET: failingBucket } as Partial<Env>,
    );

    expect(res.status).toBe(200);
    const body = await readInventoryResponse(res);
    expect(body.results).toHaveLength(1);

    const failures = await getDb(env.DB).select().from(jobFailures).all();
    const failure = failures.find((row) => row.errorMessage?.includes("r2 unavailable"));
    expect(failure?.jobType).toBe("inventory_ingestion");
    expect(failure?.jobKey).toBe("handoff");
  });

  it("returns the inventory response when ingestion queue send fails", async () => {
    const send = vi.fn<(message: InventoryIngestionQueueMessage) => Promise<QueueSendResponse>>(
      async () => {
        throw new Error("queue unavailable");
      },
    );
    const queue = { send } as unknown as Queue<InventoryIngestionQueueMessage>;
    const res = await postInventory(
      {
        client: { osVersion: "15.0", systemArchitecture: "arm64" },
        apps: [
          {
            appName: "Firefox",
            bundleId: "org.mozilla.firefox",
            teamId: "QUEUEFAIL",
            version: "130.0",
          },
        ],
      },
      { INVENTORY_INGESTION_QUEUE: queue } as Partial<Env>,
    );

    expect(res.status).toBe(200);
    const body = await readInventoryResponse(res);
    expect(body.results).toHaveLength(1);
    expect(send).toHaveBeenCalledTimes(1);
    const ingestionId = send.mock.calls[0]![0].ingestionId;

    const job = await getDb(env.DB)
      .select()
      .from(inventoryIngestionJobs)
      .where(eq(inventoryIngestionJobs.id, ingestionId))
      .get();
    expect(job?.status).toBe("pending");

    const failure = await getDb(env.DB)
      .select()
      .from(jobFailures)
      .where(eq(jobFailures.relatedId, ingestionId))
      .get();
    expect(failure?.jobType).toBe("inventory_ingestion");
    expect(failure?.jobKey).toBe("enqueue");
    expect(failure?.errorMessage).toContain("queue unavailable");
  });

  it("persists every unmatched app beyond the D1 lookup parameter chunk size", async () => {
    const prefix = "com.test.bulk.deterministic";
    const submittedApps = Array.from({ length: 125 }, (_, index) => ({
      appName: `Bulk Unknown ${index}`,
      bundleId: `${prefix}.${index}`,
      version: `1.0.${index}`,
    }));

    const res = await postInventory({ client: {}, apps: submittedApps });
    expect(res.status).toBe(200);

    const body = await readInventoryResponse(res);
    expect(body.results).toHaveLength(submittedApps.length);
    expect(body.issues.invalidApps ?? []).toHaveLength(0);

    const lookupKeys = submittedApps.map((submitted) => `bid:${submitted.bundleId}`);
    const rows = await selectDiscoveredByLookupKeys(lookupKeys);
    expect(rows).toHaveLength(submittedApps.length);
    expect(new Set(rows.map((row) => row.lookupKey)).size).toBe(submittedApps.length);
  });

  it("handles duplicate unmatched submissions without partial writes or lookup-key conflicts", async () => {
    const prefix = "com.test.race.deterministic";
    const submittedApps = Array.from({ length: 8 }, (_, index) => ({
      appName: `Race Unknown ${index}`,
      bundleId: `${prefix}.${index}`,
      version: "1.0.0",
    }));
    const request = { client: {}, apps: submittedApps };

    const responses = await Promise.all([postInventory(request), postInventory(request)]);
    expect(responses.map((res) => res.status)).toEqual([200, 200]);

    for (const res of responses) {
      const body = await readInventoryResponse(res);
      expect(body.results).toHaveLength(submittedApps.length);
      expect(body.issues.invalidApps ?? []).toHaveLength(0);
    }

    const lookupKeys = submittedApps.map((submitted) => `bid:${submitted.bundleId}`);
    const rows = await selectDiscoveredByLookupKeys(lookupKeys);
    expect(rows).toHaveLength(submittedApps.length);
    expect(new Set(rows.map((row) => row.lookupKey)).size).toBe(submittedApps.length);
    expect(rows.every((row) => row.sightingCount >= 2)).toBe(true);
  });

  it("handles multiple apps in a single request", async () => {
    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [
        { appName: "Firefox", bundleId: "org.mozilla.firefox", version: "130.0" },
        { appName: "Unknown", bundleId: "com.totally.unknown" },
      ],
    });
    const body = await readInventoryResponse(res);
    expect(body.results).toHaveLength(2);
    expect(body.results[0]!.decision).toBe("up_to_date");
    expect(body.results[1]!.decision).toBe("local_only");
  });

  it("rejects invalid envelope", async () => {
    const res = await app.request(
      "/v1/inventory/check",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ invalid: true }),
      },
      env,
    );
    expect(res.status).toBe(400);
  });
});
