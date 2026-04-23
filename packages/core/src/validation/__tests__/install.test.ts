import { describe, expect, it } from "vite-plus/test";

import {
  installExecutionCreateRequestSchema,
  installExecutionEventRequestSchema,
  inventoryResultSchema,
} from "../index";

describe("inventoryResultSchema install payload", () => {
  it("parses install and artifact metadata", () => {
    const parsed = inventoryResultSchema.parse({
      app: {
        name: "Foo",
        bundleId: "com.example.foo",
        installedVersion: "1.0.0",
      },
      decision: "update_available",
      catalog: {
        match: {
          appId: "app_123",
          appName: "Foo",
          confidence: 99,
        },
        trackingState: "public",
        localReasonCode: null,
        iconUrl: null,
        staleSince: null,
      },
      release: {
        version: "2.0.0",
        versionRaw: "2.0.0",
        releaseId: "rel_123",
        releasedAt: "2026-03-26T12:00:00Z",
        targetArchitecture: "arm64",
        artifact: {
          id: "art_123",
          downloadUrl: "https://example.com/foo.zip",
          architecture: "universal",
          minOsVersion: "13.0",
          artifactType: "zip",
          sizeBytes: 123,
          sha256: "deadbeef",
        },
      },
      install: {
        strategy: "zip_replace",
        trust: {
          status: "one_click",
          resolvedStrategy: "zip_replace",
          reasons: [],
        },
      },
      channels: {
        selected: "stable",
        available: ["stable"],
      },
    });

    expect(parsed.release.artifact?.id).toBe("art_123");
    expect(parsed.install.strategy).toBe("zip_replace");
  });

  it("parses install execution prepare and terminal status payloads", () => {
    const prepare = installExecutionCreateRequestSchema.parse({
      client: {
        platform: "macos",
        appVersion: "1.0.0",
        osVersion: "15.4",
        systemArchitecture: "arm64",
      },
      target: {
        appId: "app_123",
        releaseId: "rel_123",
        artifactId: "art_123",
        targetArchitecture: "arm64",
      },
      install: {
        strategy: "zip_replace",
        executionRoute: "local_replace",
      },
      expected: {
        previousVersion: "1.0.0",
        bundleId: "com.example.foo",
        teamId: "TEAM123456",
      },
    });

    const status = installExecutionEventRequestSchema.parse({
      ...prepare,
      event: {
        status: "succeeded",
        installedVersion: "2.0.0",
      },
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
    expect(status.target.targetArchitecture).toBe("arm64");
    expect(status.install.executionRoute).toBe("local_replace");
  });
});
