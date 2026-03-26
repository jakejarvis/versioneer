import { describe, expect, it } from "vitest";

import {
  installExecutionStatusUpdateSchema,
  installPrepareRequestSchema,
  inventoryCheckRequestSchema,
  inventoryCheckResponseSchema,
} from "./index";

describe("public contract schemas", () => {
  it("accepts an empty inventory scan payload", () => {
    const parsed = inventoryCheckRequestSchema.parse({
      client: {
        installId: "install_test",
        platform: "macos",
        appVersion: "1.0",
        osVersion: "15.0",
        systemArchitecture: "arm64",
      },
      apps: [],
      scanDurationMs: 0,
    });

    expect(parsed.apps).toEqual([]);
  });

  it("accepts the inventory response shape used by the desktop app", () => {
    const parsed = inventoryCheckResponseSchema.parse({
      snapshotId: "cis_123",
      processedAt: "2026-03-26T18:00:00Z",
      results: [
        {
          appName: "Firefox",
          bundleId: "org.mozilla.firefox",
          installedVersion: "126.0",
          matchedAppId: "app_firefox",
          matchedAppName: "Mozilla Firefox",
          matchConfidence: 98,
          decision: "update_available",
          latestVersion: "127.0",
          latestVersionRaw: "127.0",
          latestReleaseId: "rel_firefox",
          releasedAt: "2026-03-20T12:00:00Z",
          iconUrl: "https://assets.example.com/firefox.png",
          artifact: {
            id: "artifact_firefox",
            downloadUrl: "https://example.com/firefox.zip",
            architecture: "universal",
            minOsVersion: "13.0",
            artifactType: "zip",
            sizeBytes: 182452384,
            sha256: "abc123",
            expectedTeamId: "43AQ936H96",
            expectedBundleId: "org.mozilla.firefox",
            expectedVersionRaw: "127.0",
          },
          install: {
            canInstall: true,
            installabilityClass: "assisted_replace",
            strategy: "zip_replace",
            requiresQuit: true,
            requiresAdmin: false,
            supportsSilent: false,
            eligibility: "eligible",
          },
        },
      ],
    });

    expect(parsed.results[0]?.iconUrl).toBe("https://assets.example.com/firefox.png");
    expect(parsed.results[0]?.install.strategy).toBe("zip_replace");
  });

  it("accepts install prepare requests from the desktop client", () => {
    const parsed = installPrepareRequestSchema.parse({
      installId: "install_test",
      snapshotId: "cis_123",
      matchedAppId: "app_firefox",
      releaseId: "rel_firefox",
      installedVersion: "126.0",
      localAppPath: "/Applications/Firefox.app",
      strategyCandidate: "zip_replace",
    });

    expect(parsed.strategyCandidate).toBe("zip_replace");
    expect(parsed.localAppPath).toBe("/Applications/Firefox.app");
  });

  it("accepts execution status updates from the desktop client", () => {
    const parsed = installExecutionStatusUpdateSchema.parse({
      installId: "install_test",
      actionStatus: "completed",
      clientVersionAfter: "127.0",
      errorMessage: null,
      durationMs: 3210,
      detailsJson: '{"strategy":"zip_replace"}',
    });

    expect(parsed.actionStatus).toBe("completed");
    expect(parsed.clientVersionAfter).toBe("127.0");
  });
});
