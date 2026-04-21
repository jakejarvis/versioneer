import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq, inArray } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { discoveredApps } from "@versioneer/db";

import { getDb } from "../../__tests__/seed";
import app from "../../index";
import { MAX_INVENTORY_GZIP_BYTES, MAX_INVENTORY_JSON_BYTES } from "../../lib/constants";
import { seedInventoryCatalog } from "./fixtures/inventory-seed";

type InventoryResponse = {
  results: Array<{
    appName: string;
    bundleId: string | null;
    decision: string;
    trackingState: string;
    localReasonCode: string | null;
    matchedAppId: string | null;
    matchedAppName: string | null;
    matchConfidence: number | null;
    latestVersion: string | null;
    latestReleaseId: string | null;
    homebrewCaskToken?: string | null;
    artifact: { id: string; downloadUrl: string; architecture: string | null } | null;
    installStrategy: string | null;
    staleSince: string | null;
    channel: string | null;
  }>;
  skipped?: Array<{ index: number; appName: string | null; reasons: string[] }>;
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

beforeAll(async () => {
  const db = getDb(env.DB);
  catalog = await seedInventoryCatalog(db);
});

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(TEST_NOW);
});

describe("POST /v1/inventory/check", () => {
  it("returns empty results for empty apps array", async () => {
    const res = await postInventory({ client: {}, apps: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as InventoryResponse;
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
    const responseBody = (await res.json()) as InventoryResponse;
    expect(responseBody.results[0]!.decision).toBe("up_to_date");
  });

  it("rejects raw inventory bodies over the decoded JSON limit", async () => {
    const res = await postInventoryRequest({
      body: new Uint8Array(MAX_INVENTORY_JSON_BYTES + 1),
    });

    expect(res.status).toBe(413);
  });

  it("rejects gzip inventory bodies over the compressed limit", async () => {
    const res = await postInventoryRequest({
      headers: { "Content-Encoding": "gzip" },
      body: new Uint8Array(MAX_INVENTORY_GZIP_BYTES + 1),
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
    const body = (await res.json()) as InventoryResponse;
    expect(body.results).toHaveLength(1);
    const result = body.results[0]!;
    expect(result.decision).toBe("up_to_date");
    expect(result.trackingState).toBe("public");
    expect(result.matchedAppId).toBe(catalog.appA.id);
    expect(result.latestVersion).toBe("130.0");
    expect(result.artifact).not.toBeNull();
    expect(result.installStrategy).toBe("dmg_copy_replace");
    expect(result.homebrewCaskToken).toBe("firefox");
    expect(result.localReasonCode).toBeNull();
  });

  it("matches an app by bundle_id — update available", async () => {
    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "arm64" },
      apps: [{ appName: "Firefox", bundleId: "org.mozilla.firefox", version: "120.0" }],
    });
    const body = (await res.json()) as InventoryResponse;
    const result = body.results[0]!;
    expect(result.decision).toBe("update_available");
    expect(result.latestVersion).toBe("130.0");
  });

  it("returns ambiguous when no installed version provided", async () => {
    const res = await postInventory({
      client: {},
      apps: [{ appName: "Firefox", bundleId: "org.mozilla.firefox" }],
    });
    const body = (await res.json()) as InventoryResponse;
    const result = body.results[0]!;
    expect(result.decision).toBe("ambiguous");
  });

  it("returns local_only / not_found for unmatched app", async () => {
    const res = await postInventory({
      client: {},
      apps: [{ appName: "Unknown App", bundleId: "com.unknown.app" }],
    });
    const body = (await res.json()) as InventoryResponse;
    const result = body.results[0]!;
    expect(result.decision).toBe("local_only");
    expect(result.trackingState).toBe("local_only");
    expect(result.localReasonCode).toBe("not_found");
    expect(result.matchedAppId).toBeNull();
  });

  it("returns local_only / matched_draft for draft app", async () => {
    const res = await postInventory({
      client: {},
      apps: [{ appName: "Draft App", bundleId: "com.example.draft", version: "1.0" }],
    });
    const body = (await res.json()) as InventoryResponse;
    const result = body.results[0]!;
    expect(result.decision).toBe("local_only");
    expect(result.localReasonCode).toBe("matched_draft");
  });

  it("returns local_only / no_approved_source for app without sources", async () => {
    const res = await postInventory({
      client: {},
      apps: [{ appName: "No Source App", bundleId: "com.example.nosource", version: "1.0" }],
    });
    const body = (await res.json()) as InventoryResponse;
    const result = body.results[0]!;
    expect(result.decision).toBe("local_only");
    expect(result.localReasonCode).toBe("no_approved_source");
  });

  it("handles incompatible architecture by falling back", async () => {
    const res = await postInventory({
      client: { osVersion: "15.0", systemArchitecture: "x86_64" },
      apps: [{ appName: "Sketch", bundleId: "com.bohemiancoding.sketch3", version: "99.0" }],
    });
    const body = (await res.json()) as InventoryResponse;
    const result = body.results[0]!;
    // arm64-only artifact is incompatible with x86_64, no older compatible releases exist
    // so the handler falls through to no_approved_source
    expect(result.decision).toBe("local_only");
    expect(result.localReasonCode).toBe("no_approved_source");
  });

  it("handles incompatible OS version by falling back", async () => {
    const res = await postInventory({
      client: { osVersion: "13.0", systemArchitecture: "arm64" },
      apps: [{ appName: "Sketch", bundleId: "com.bohemiancoding.sketch3", version: "99.0" }],
    });
    const body = (await res.json()) as InventoryResponse;
    const result = body.results[0]!;
    // minOsVersion 14.0 is incompatible with client OS 13.0, no older compatible releases
    expect(result.decision).toBe("local_only");
    expect(result.localReasonCode).toBe("no_approved_source");
  });

  it("reports skipped apps for invalid entries", async () => {
    const res = await postInventory({
      client: {},
      apps: [
        { appName: "Valid App" },
        { appName: 123 }, // invalid: appName must be string
      ],
    });
    const body = (await res.json()) as InventoryResponse;
    expect(body.results).toHaveLength(1);
    expect(body.skipped).toHaveLength(1);
    expect(body.skipped![0]!.index).toBe(1);
    expect(body.skipped![0]!.reasons.length).toBeGreaterThan(0);
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

  it("persists every unmatched app beyond the D1 lookup parameter chunk size", async () => {
    const prefix = "com.test.bulk.deterministic";
    const submittedApps = Array.from({ length: 125 }, (_, index) => ({
      appName: `Bulk Unknown ${index}`,
      bundleId: `${prefix}.${index}`,
      version: `1.0.${index}`,
    }));

    const res = await postInventory({ client: {}, apps: submittedApps });
    expect(res.status).toBe(200);

    const body = (await res.json()) as InventoryResponse;
    expect(body.results).toHaveLength(submittedApps.length);
    expect(body.skipped ?? []).toHaveLength(0);

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
      const body = (await res.json()) as InventoryResponse;
      expect(body.results).toHaveLength(submittedApps.length);
      expect(body.skipped ?? []).toHaveLength(0);
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
    const body = (await res.json()) as InventoryResponse;
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
