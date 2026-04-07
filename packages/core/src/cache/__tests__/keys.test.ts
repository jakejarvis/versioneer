import { describe, expect, it } from "vitest";

import {
  bundleLookupKey,
  dismissedBundleIdsKey,
  latestReleaseKey,
  recentReleasesKey,
} from "../keys";

describe("latestReleaseKey", () => {
  it("formats key with appId and channel", () => {
    expect(latestReleaseKey("app_123", "stable")).toBe("latest:app:app_123:stable");
  });

  it("works with beta channel", () => {
    expect(latestReleaseKey("app_456", "beta")).toBe("latest:app:app_456:beta");
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

describe("dismissedBundleIdsKey", () => {
  it("returns static key", () => {
    expect(dismissedBundleIdsKey()).toBe("dismissed-bundle-ids");
  });
});
