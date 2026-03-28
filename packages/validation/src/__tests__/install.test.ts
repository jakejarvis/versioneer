import { describe, expect, it } from "vitest";

import {
  appDecisionSchema,
  installPrepareRequestSchema,
  installExecutionStatusUpdateSchema,
} from "../index";

describe("installPrepareRequestSchema", () => {
  it("accepts a valid install prepare request", () => {
    const parsed = installPrepareRequestSchema.parse({
      installId: "machine-123",
      snapshotId: "snap_123",
      matchedAppId: "app_123",
      releaseId: "rel_123",
      installedVersion: "1.0.0",
      localAppPath: "/Applications/Foo.app",
      strategyCandidate: "zip_replace",
    });

    expect(parsed.strategyCandidate).toBe("zip_replace");
  });
});

describe("installExecutionStatusUpdateSchema", () => {
  it("accepts execution status updates with details JSON", () => {
    const parsed = installExecutionStatusUpdateSchema.parse({
      installId: "machine-123",
      actionStatus: "completed",
      clientVersionAfter: "2.0.0",
      durationMs: 1234,
      detailsJson: '{"hashVerified":true}',
    });

    expect(parsed.actionStatus).toBe("completed");
  });
});

describe("appDecisionSchema install payload", () => {
  it("parses install and artifact metadata", () => {
    const parsed = appDecisionSchema.parse({
      appName: "Foo",
      bundleId: "com.example.foo",
      installedVersion: "1.0.0",
      matchedAppId: "app_123",
      matchedAppName: "Foo",
      matchConfidence: 99,
      decision: "update_available",
      isVerified: true,
      latestVersion: "2.0.0",
      latestVersionRaw: "2.0.0",
      latestReleaseId: "rel_123",
      releasedAt: "2026-03-26T12:00:00Z",
      staleSince: null,
      iconUrl: null,
      artifact: {
        id: "art_123",
        downloadUrl: "https://example.com/foo.zip",
        architecture: "universal",
        minOsVersion: "13.0",
        artifactType: "zip",
        sizeBytes: 123,
        sha256: "deadbeef",
      },
      installStrategy: "zip_replace",
    });

    expect(parsed.artifact?.id).toBe("art_123");
    expect(parsed.installStrategy).toBe("zip_replace");
  });
});
