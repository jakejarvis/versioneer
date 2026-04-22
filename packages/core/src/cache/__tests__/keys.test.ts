import { describe, expect, it } from "vite-plus/test";

import {
  bundleLookupKey,
  dismissedBundleIdsKey,
  inventoryMatchSnapshotKey,
  latestReleaseKey,
  recentReleasesKey,
} from "../keys";

describe("latestReleaseKey", () => {
  it("formats key with appId, channel, and target architecture", () => {
    expect(latestReleaseKey("app_123", "stable", "arm64")).toBe("latest:app:app_123:stable:arm64");
  });

  it("works with beta channel", () => {
    expect(latestReleaseKey("app_456", "beta", "x86_64")).toBe("latest:app:app_456:beta:x86_64");
  });
});

describe("bundleLookupKey", () => {
  it("formats key with lowercased bundleId", () => {
    expect(bundleLookupKey("com.example.App")).toBe("lookup:bundle:com.example.app");
  });

  it("lowercases the entire bundleId", () => {
    expect(bundleLookupKey("COM.APPLE.SAFARI")).toBe("lookup:bundle:com.apple.safari");
  });

  it("preserves already-lowercase bundleId", () => {
    expect(bundleLookupKey("com.example.app")).toBe("lookup:bundle:com.example.app");
  });
});

describe("recentReleasesKey", () => {
  it("returns static key", () => {
    expect(recentReleasesKey()).toBe("recent-releases");
  });
});

describe("inventoryMatchSnapshotKey", () => {
  it("returns versioned static key", () => {
    expect(inventoryMatchSnapshotKey()).toBe("inventory-match-snapshot:v1");
  });
});

describe("dismissedBundleIdsKey", () => {
  it("returns static key", () => {
    expect(dismissedBundleIdsKey()).toBe("dismissed-bundle-ids");
  });
});
