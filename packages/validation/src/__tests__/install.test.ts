import { describe, expect, it } from "vitest";

import { appDecisionSchema } from "../index";

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
