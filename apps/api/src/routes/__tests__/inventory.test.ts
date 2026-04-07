import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { beforeAll, describe, expect, it } from "vitest";

import { discoveredApps } from "@versioneer/db";

import { getDb } from "../../__tests__/seed";
import app from "../../index";
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

async function postInventory(
  body: { client: Record<string, unknown>; apps: unknown[]; scanDurationMs?: number },
  extraEnv?: Partial<Env>,
) {
  const ctx = createExecutionContext();
  const res = await app.request(
    "/v1/inventory/check",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    { ...env, ...extraEnv },
    ctx,
  );
  await waitOnExecutionContext(ctx);
  return res;
}

let catalog: Awaited<ReturnType<typeof seedInventoryCatalog>>;

beforeAll(async () => {
  const db = getDb(env.DB);
  catalog = await seedInventoryCatalog(db);
});

describe("POST /v1/inventory/check", () => {
  it("returns empty results for empty apps array", async () => {
    const res = await postInventory({ client: {}, apps: [] });
    expect(res.status).toBe(200);
    const body = (await res.json()) as InventoryResponse;
    expect(body.results).toEqual([]);
    expect(body.processedAt).toBeDefined();
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
    const uniqueBundle = `com.test.discovered.${Date.now()}`;
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
