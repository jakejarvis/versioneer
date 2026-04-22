import { describe, expect, it } from "vite-plus/test";

import { createMockKV } from "../../__tests__/test-utils";
import type { CachedLatestRelease, CachedRecentRelease } from "../helpers";
import {
  deleteCachedLatest,
  getCachedBundleLookup,
  getCachedDismissedBundleIds,
  getCachedLatest,
  getCachedRecentReleases,
  setCachedBundleLookup,
  setCachedDismissedBundleIds,
  setCachedLatest,
  setCachedRecentReleases,
} from "../helpers";

describe("cached latest release", () => {
  it("round-trips set and get", async () => {
    const kv = createMockKV();
    const data: CachedLatestRelease = {
      appId: "app_123",
      releaseId: "rel_456",
      versionNormalized: "0000001.0000000.0000000",
      versionRaw: "1.0.0",
      channel: "stable",
      targetArchitecture: "arm64",
      releasedAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    };
    await setCachedLatest(kv, data);
    const result = await getCachedLatest(kv, "app_123", "stable", "arm64");
    expect(result).toEqual(data);
  });

  it("returns null for missing key", async () => {
    const kv = createMockKV();
    const result = await getCachedLatest(kv, "app_missing", "stable");
    expect(result).toBeNull();
  });

  it("returns null for corrupted JSON", async () => {
    const kv = createMockKV();
    kv.store.set("latest:app:app_123:stable:arm64", "not-json");
    const result = await getCachedLatest(kv, "app_123", "stable", "arm64");
    expect(result).toBeNull();
  });

  it("defaults to stable channel", async () => {
    const kv = createMockKV();
    const data: CachedLatestRelease = {
      appId: "app_123",
      releaseId: "rel_456",
      versionNormalized: "0000001.0000000.0000000",
      versionRaw: "1.0.0",
      channel: "stable",
      targetArchitecture: "arm64",
      releasedAt: null,
      updatedAt: "2026-01-01T00:00:00Z",
    };
    await setCachedLatest(kv, data);
    const result = await getCachedLatest(kv, "app_123");
    expect(result).toEqual(data);
  });

  it("deletes architecture-specific latest entries", async () => {
    const kv = createMockKV();
    const data: CachedLatestRelease = {
      appId: "app_123",
      releaseId: "rel_456",
      versionNormalized: "0000001.0000000.0000000",
      versionRaw: "1.0.0",
      channel: "beta",
      targetArchitecture: "x86_64",
      releasedAt: null,
      updatedAt: "2026-01-01T00:00:00Z",
    };
    await setCachedLatest(kv, data);
    await deleteCachedLatest(kv, "app_123", "beta", "x86_64");
    expect(await getCachedLatest(kv, "app_123", "beta", "x86_64")).toBeNull();
  });
});

describe("cached recent releases", () => {
  it("round-trips set and get", async () => {
    const kv = createMockKV();
    const data: CachedRecentRelease[] = [
      {
        appId: "app_1",
        appName: "App 1",
        appSlug: "app-1",
        vendorName: "Vendor",
        iconUrl: null,
        releaseId: "rel_1",
        version: "1.0.0",
        releasedAt: "2026-01-01T00:00:00Z",
      },
    ];
    await setCachedRecentReleases(kv, data);
    const result = await getCachedRecentReleases(kv);
    expect(result).toEqual(data);
  });

  it("returns null for missing key", async () => {
    const kv = createMockKV();
    expect(await getCachedRecentReleases(kv)).toBeNull();
  });
});

describe("cached dismissed bundle IDs", () => {
  it("round-trips set and get", async () => {
    const kv = createMockKV();
    const ids = ["com.example.foo", "com.example.bar"];
    await setCachedDismissedBundleIds(kv, ids);
    const result = await getCachedDismissedBundleIds(kv);
    expect(result).toEqual(ids);
  });

  it("returns null for missing key", async () => {
    const kv = createMockKV();
    expect(await getCachedDismissedBundleIds(kv)).toBeNull();
  });
});

describe("cached bundle lookup", () => {
  it("round-trips set and get", async () => {
    const kv = createMockKV();
    await setCachedBundleLookup(kv, "com.example.App", "app_123");
    const result = await getCachedBundleLookup(kv, "com.example.App");
    expect(result).toBe("app_123");
  });

  it("lowercases bundle ID in key", async () => {
    const kv = createMockKV();
    await setCachedBundleLookup(kv, "COM.EXAMPLE.APP", "app_123");
    // Should be findable with same casing (getCachedBundleLookup also lowercases)
    const result = await getCachedBundleLookup(kv, "com.example.app");
    expect(result).toBe("app_123");
  });

  it("returns null for missing key", async () => {
    const kv = createMockKV();
    expect(await getCachedBundleLookup(kv, "com.missing")).toBeNull();
  });
});
