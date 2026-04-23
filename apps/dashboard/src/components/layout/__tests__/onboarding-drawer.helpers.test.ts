import { beforeEach, describe, expect, it, vi } from "vite-plus/test";

import {
  buildInitialValues,
  formatDate,
  reorderItems,
  type OnboardingDiscoveredApp,
} from "../onboarding-drawer.helpers";

const TEST_UUID = "00000000-0000-0000-0000-000000000000";

describe("onboarding drawer helpers", () => {
  beforeEach(() => {
    vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => TEST_UUID);
  });

  it("builds aliases and GitHub release sources from discovered app data", () => {
    const discoveredApp: OnboardingDiscoveredApp = {
      id: "disc_1",
      appName: "Raycast",
      bundleId: "com.raycast.macos",
      teamId: "RAYCAST123",
      masAppId: null,
      sparkleFeedUrl: "https://example.com/appcast.xml",
      electronUpdateUrl: "https://github.com/raycast/app/releases",
      isMasApp: false,
      sourceValidationStatus: "valid",
      enrichedVendorName: "Raycast",
      enrichedHomepageUrl: "https://raycast.com",
      enrichedReleaseCount: 12,
      enrichedLatestVersion: "1.0.0",
      enrichedLatestPublishedAt: "2026-04-20T12:00:00.000Z",
      iconR2Key: null,
      confidenceScore: 92,
      electronUpdateProvider: "github",
      minMacOSVersion: "14.0",
      homebrewCaskToken: null,
    };

    const values = buildInitialValues(discoveredApp);

    expect(values.canonicalName).toBe("Raycast");
    expect(values.slug).toBe("raycast");
    expect(values.aliases.map((entry) => [entry.aliasType, entry.value])).toEqual([
      ["bundle_id", "com.raycast.macos"],
      ["name", "Raycast"],
      ["team_id", "RAYCAST123"],
    ]);
    expect(values.sources.map((entry) => [entry.sourceType, entry.identifier])).toEqual([
      ["sparkle", "https://example.com/appcast.xml"],
      ["github_releases", "raycast/app"],
    ]);
    expect(values.sourceValidated).toBe(true);
  });

  it("falls back to a Mac App Store source when the app is MAS-only", () => {
    const values = buildInitialValues({
      id: "disc_2",
      appName: "Xcode",
      bundleId: "com.apple.dt.Xcode",
      teamId: null,
      masAppId: "497799835",
      sparkleFeedUrl: null,
      electronUpdateUrl: null,
      isMasApp: true,
      sourceValidationStatus: null,
      enrichedVendorName: null,
      enrichedHomepageUrl: null,
      enrichedReleaseCount: null,
      enrichedLatestVersion: null,
      enrichedLatestPublishedAt: null,
      iconR2Key: null,
      confidenceScore: null,
      electronUpdateProvider: null,
      minMacOSVersion: null,
      homebrewCaskToken: null,
    });

    expect(values.sources).toEqual([
      {
        key: TEST_UUID,
        sourceType: "mac_app_store",
        identifier: "com.apple.dt.Xcode",
        pollIntervalMinutes: 1440,
        status: "active",
        config: {},
      },
    ]);
  });

  it("formats dates safely and preserves reorder behavior", () => {
    expect(formatDate("2026-04-23T12:00:00.000Z")).toBe("Apr 23, 2026");
    expect(formatDate("not-a-date")).toBeNull();

    expect(reorderItems(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
    expect(reorderItems(["a", "b", "c"], 1, 1)).toEqual(["a", "b", "c"]);
  });
});
