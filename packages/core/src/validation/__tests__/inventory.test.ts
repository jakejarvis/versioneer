import { describe, expect, it } from "vite-plus/test";

import {
  installedAppSchema,
  inventoryCheckResponseSchema,
  inventoryRequestEnvelopeSchema,
} from "../inventory";

describe("installedAppSchema", () => {
  it("parses a valid minimal app", () => {
    const result = installedAppSchema.parse({ appName: "Foo" });
    expect(result.appName).toBe("Foo");
    expect(result.bundleId).toBeUndefined();
  });

  it("parses a fully populated app", () => {
    const result = installedAppSchema.parse({
      appName: "Visual Studio Code",
      bundleId: "com.microsoft.VSCode",
      version: "1.90.0",
      buildNumber: "1234567890",
      teamId: "UBF8T346G9",
      architecture: "arm64",
      sparkleFeedUrl: "https://example.com/appcast.xml",
      sparklePublicKey: "dsa_pub_key...",
      isSparkleApp: true,
      isMasApp: false,
      masAppId: "497799835",
      isElectronApp: true,
      electronUpdateProvider: "generic",
      electronUpdateUrl: "https://update.code.visualstudio.com",
      codeSigningAuthority: "Developer ID Application: Microsoft Corporation",
      appCategory: "public.app-category.developer-tools",
      minMacOSVersion: "13.0",
      iconBase64: "iVBOR...",
      isHomebrewInstalled: true,
      homebrewCaskToken: "visual-studio-code",
    });
    expect(result.bundleId).toBe("com.microsoft.VSCode");
    expect(result.isElectronApp).toBe(true);
  });

  it("rejects missing appName", () => {
    expect(installedAppSchema.safeParse({}).success).toBe(false);
  });

  it("rejects empty appName", () => {
    expect(installedAppSchema.safeParse({ appName: "" }).success).toBe(false);
  });

  it("rejects appName exceeding max length", () => {
    expect(installedAppSchema.safeParse({ appName: "x".repeat(501) }).success).toBe(false);
  });

  it("rejects bundleId exceeding max length", () => {
    expect(
      installedAppSchema.safeParse({ appName: "Foo", bundleId: "x".repeat(501) }).success,
    ).toBe(false);
  });
});

describe("inventoryRequestEnvelopeSchema", () => {
  it("parses a valid envelope with unknown apps", () => {
    const result = inventoryRequestEnvelopeSchema.parse({
      client: {},
      apps: [{ appName: "Foo" }, { invalid: true }],
    });
    expect(result.client.platform).toBe("macos"); // default
    expect(result.apps).toHaveLength(2);
  });

  it("applies default platform", () => {
    const result = inventoryRequestEnvelopeSchema.parse({ client: {}, apps: [] });
    expect(result.client.platform).toBe("macos");
  });

  it("rejects apps array exceeding 5000", () => {
    expect(
      inventoryRequestEnvelopeSchema.safeParse({
        client: {},
        apps: Array.from({ length: 5001 }, () => ({})),
      }).success,
    ).toBe(false);
  });

  it("accepts optional scanDurationMs", () => {
    const result = inventoryRequestEnvelopeSchema.parse({
      client: {},
      apps: [],
      scanDurationMs: 1234,
    });
    expect(result.scanDurationMs).toBe(1234);
  });

  it("parses channel preferences", () => {
    const result = inventoryRequestEnvelopeSchema.parse({
      client: {
        channelPreferences: {
          defaultChannel: "beta",
          perApp: { app_123: "stable" },
        },
      },
      apps: [],
    });
    expect(result.client.channelPreferences?.defaultChannel).toBe("beta");
  });
});

describe("inventoryCheckResponseSchema", () => {
  it("parses a valid response", () => {
    const result = inventoryCheckResponseSchema.parse({
      results: [
        {
          appName: "Foo",
          bundleId: "com.example.foo",
          installedVersion: "1.0.0",
          matchedAppId: "app_123",
          matchedAppName: "Foo",
          matchConfidence: 100,
          decision: "up_to_date",
          trackingState: "public",
          localReasonCode: null,
          latestVersion: "1.0.0",
          latestVersionRaw: "1.0.0",
          latestReleaseId: "rel_123",
          targetArchitecture: "arm64",
          releasedAt: "2026-01-01T00:00:00Z",
          staleSince: null,
          iconUrl: null,
          artifact: null,
          installStrategy: null,
          installTrust: {
            status: "none",
            resolvedStrategy: null,
            reasons: [],
          },
        },
      ],
      processedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.results).toHaveLength(1);
    expect(result.results[0]!.decision).toBe("up_to_date");
  });

  it("accepts optional skipped array", () => {
    const result = inventoryCheckResponseSchema.parse({
      results: [],
      skipped: [{ index: 0, appName: null, reasons: ["Invalid bundleId"] }],
      processedAt: "2026-01-01T00:00:00Z",
    });
    expect(result.skipped).toHaveLength(1);
  });
});
