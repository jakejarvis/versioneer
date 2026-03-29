import { describe, expect, it } from "vitest";

import {
  installExecutionStatusResponseSchema,
  installPrepareResponseSchema,
  inventoryCheckRequestSchema,
  inventoryCheckResponseSchema,
} from "./index";

describe("public contract schemas", () => {
  it("accepts an empty inventory scan payload", () => {
    const parsed = inventoryCheckRequestSchema.parse({
      client: {
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
          trackingState: "public",
          localReasonCode: null,
          latestVersion: "127.0",
          latestVersionRaw: "127.0",
          latestReleaseId: "rel_firefox",
          releasedAt: "2026-03-20T12:00:00Z",
          staleSince: null,
          iconUrl: "https://assets.example.com/firefox.png",
          artifact: {
            id: "artifact_firefox",
            downloadUrl: "https://example.com/firefox.zip",
            architecture: "universal",
            minOsVersion: "13.0",
            artifactType: "zip",
            sizeBytes: 182452384,
            sha256: "abc123",
          },
          installStrategy: "zip_replace",
        },
      ],
    });

    expect(parsed.results[0]?.iconUrl).toBe("https://assets.example.com/firefox.png");
    expect(parsed.results[0]?.installStrategy).toBe("zip_replace");
  });

  it("accepts install prepare and status response payloads", () => {
    const prepare = installPrepareResponseSchema.parse({
      executionId: "exec_123",
      status: "prepared",
    });
    const status = installExecutionStatusResponseSchema.parse({
      executionId: "exec_123",
      status: "recorded",
    });

    expect(prepare.executionId).toBe("exec_123");
    expect(status.status).toBe("recorded");
  });
});
