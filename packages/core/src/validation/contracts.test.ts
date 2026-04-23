import { describe, expect, it } from "vite-plus/test";

import {
  clientPreflightResponseSchema,
  installExecutionCreateResponseSchema,
  installExecutionEventResponseSchema,
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

  it("accepts richer installed-app identity fields", () => {
    const parsed = inventoryCheckRequestSchema.parse({
      client: {
        platform: "macos",
        osVersion: "15.0",
        systemArchitecture: "arm64",
      },
      apps: [
        {
          appName: "Safari",
          bundleId: "com.apple.Safari",
          isMasApp: true,
          masAppId: "1569813296",
          electronUpdateUrl: "https://updates.example.com/app",
        },
      ],
    });

    expect(parsed.apps[0]?.masAppId).toBe("1569813296");
    expect(parsed.apps[0]?.electronUpdateUrl).toBe("https://updates.example.com/app");
  });

  it("accepts non-URL strings in sparkleFeedUrl and electronUpdateUrl", () => {
    const parsed = inventoryCheckRequestSchema.parse({
      client: { platform: "macos" },
      apps: [
        {
          appName: "BrokenApp",
          sparkleFeedUrl: "SPARKLE_FEED_URL",
          electronUpdateUrl: "/relative/path",
        },
      ],
    });

    expect(parsed.apps[0]?.sparkleFeedUrl).toBe("SPARKLE_FEED_URL");
    expect(parsed.apps[0]?.electronUpdateUrl).toBe("/relative/path");
  });

  it("accepts the inventory response shape used by the desktop app", () => {
    const parsed = inventoryCheckResponseSchema.parse({
      processedAt: "2026-03-26T18:00:00Z",
      results: [
        {
          app: {
            name: "Firefox",
            bundleId: "org.mozilla.firefox",
            installedVersion: "126.0",
          },
          decision: "update_available",
          catalog: {
            match: {
              appId: "app_firefox",
              appName: "Mozilla Firefox",
              confidence: 98,
            },
            trackingState: "public",
            localReasonCode: null,
            iconUrl: "https://assets.example.com/firefox.png",
            staleSince: null,
          },
          release: {
            version: "127.0",
            versionRaw: "127.0",
            releaseId: "rel_firefox",
            releasedAt: "2026-03-20T12:00:00Z",
            targetArchitecture: "arm64",
            artifact: {
              id: "artifact_firefox",
              downloadUrl: "https://example.com/firefox.zip",
              architecture: "universal",
              minOsVersion: "13.0",
              artifactType: "zip",
              sizeBytes: 182452384,
              sha256: "abc123",
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
            available: ["stable", "beta"],
          },
        },
      ],
      issues: {
        invalidApps: [],
      },
    });

    expect(parsed.results[0]?.catalog.iconUrl).toBe("https://assets.example.com/firefox.png");
    expect(parsed.results[0]?.install.strategy).toBe("zip_replace");
  });

  it("accepts inventory response with invalid app issues", () => {
    const parsed = inventoryCheckResponseSchema.parse({
      processedAt: "2026-04-07T12:00:00Z",
      results: [],
      issues: {
        invalidApps: [
          {
            index: 112,
            appName: "BrokenApp",
            reasons: ["sparkleFeedUrl: Invalid URL"],
          },
        ],
      },
    });

    expect(parsed.issues.invalidApps).toHaveLength(1);
    expect(parsed.issues.invalidApps[0]?.appName).toBe("BrokenApp");
  });

  it("accepts preflight response with dismissed bundle IDs", () => {
    const parsed = clientPreflightResponseSchema.parse({
      dismissedBundleIds: ["com.adobe.Install", "com.example.foo"],
    });

    expect(parsed.dismissedBundleIds).toEqual(["com.adobe.Install", "com.example.foo"]);
  });

  it("accepts preflight response with empty dismissed list", () => {
    const parsed = clientPreflightResponseSchema.parse({
      dismissedBundleIds: [],
    });

    expect(parsed.dismissedBundleIds).toEqual([]);
  });

  it("accepts install prepare and status response payloads", () => {
    const prepare = installExecutionCreateResponseSchema.parse({
      execution: {
        id: "exec_123",
        status: "prepared",
      },
    });
    const status = installExecutionEventResponseSchema.parse({
      execution: {
        id: "exec_123",
        status: "recorded",
      },
    });

    expect(prepare.execution.id).toBe("exec_123");
    expect(status.execution.status).toBe("recorded");
  });
});
