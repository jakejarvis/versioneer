import { describe, expect, it } from "vitest";

import {
  appDecisionSchema,
  installExecutionStatusRequestSchema,
  installPrepareRequestSchema,
} from "../index";

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
      trackingState: "public",
      localReasonCode: null,
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

  it("parses install execution prepare and terminal status payloads", () => {
    const prepare = installPrepareRequestSchema.parse({
      client: {
        platform: "macos",
        appVersion: "1.0.0",
        osVersion: "15.4",
        systemArchitecture: "arm64",
      },
      appId: "app_123",
      releaseId: "rel_123",
      artifactId: "art_123",
      installStrategy: "zip_replace",
      executionRoute: "local_replace",
      previousVersion: "1.0.0",
      bundleId: "com.example.foo",
      teamId: "TEAM123456",
    });

    const status = installExecutionStatusRequestSchema.parse({
      ...prepare,
      status: "succeeded",
      installedVersion: "2.0.0",
      verification: {
        strategy: "zip_replace",
        executionRoute: "local_replace",
        hashVerified: true,
        signatureVerified: true,
        notarizationVerified: true,
        bundleIdMatch: true,
        teamIdMatch: true,
        observedBundleId: "com.example.foo",
        observedTeamId: "TEAM123456",
        observedVersion: "2.0.0",
      },
    });

    expect(status.verification?.signatureVerified).toBe(true);
    expect(status.executionRoute).toBe("local_replace");
  });
});
