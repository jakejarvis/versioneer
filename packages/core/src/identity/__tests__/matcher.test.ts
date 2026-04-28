import { describe, it, expect } from "vite-plus/test";

import { createAliasMatchIndex, matchApp, matchAppWithIndex } from "../matcher";
import type { MatchInput } from "../types";
import type { AliasRecord, TrustAssertionRecord } from "../types";

const aliases: AliasRecord[] = [
  {
    appId: "app_firefox",
    appName: "Firefox",
    aliasType: "bundle_id",
    value: "org.mozilla.firefox",
    normalizedValue: "org.mozilla.firefox",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_firefox",
    appName: "Firefox",
    aliasType: "name",
    value: "Firefox",
    normalizedValue: "firefox",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_firefox",
    appName: "Firefox",
    aliasType: "team_id",
    value: "43AQ936H96",
    normalizedValue: "43aq936h96",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_firefox",
    appName: "Firefox",
    aliasType: "mas_app_id",
    value: "989804926",
    normalizedValue: "989804926",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_firefox",
    appName: "Firefox",
    aliasType: "homebrew_cask",
    value: "firefox",
    normalizedValue: "firefox",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_firefox",
    appName: "Firefox",
    aliasType: "sparkle_feed",
    value: "https://example.com/firefox/appcast.xml",
    normalizedValue: "https://example.com/firefox/appcast.xml",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_vscode",
    appName: "Visual Studio Code",
    aliasType: "bundle_id",
    value: "com.microsoft.VSCode",
    normalizedValue: "com.microsoft.vscode",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_vscode",
    appName: "Visual Studio Code",
    aliasType: "name",
    value: "Visual Studio Code",
    normalizedValue: "visual studio code",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_vscode",
    appName: "Visual Studio Code",
    aliasType: "electron_update_url",
    value: "https://updates.example.com/vscode",
    normalizedValue: "https://updates.example.com/vscode",
    isExact: true,
    confidenceWeight: 100,
  },
  {
    appId: "app_pages",
    appName: "Pages",
    aliasType: "mas_app_id",
    value: "409201541",
    normalizedValue: "409201541",
    isExact: true,
    confidenceWeight: 100,
  },
];

const sparkleTrustAssertions: TrustAssertionRecord[] = [
  {
    appId: "app_firefox",
    assertionType: "sparkle_public_key",
    value: "abc123+/=",
  },
  {
    appId: "app_vscode",
    assertionType: "sparkle_public_key",
    value: "xyz789+/=",
  },
];

function expectIndexedMatchToEqualLinear(
  input: MatchInput,
  records: AliasRecord[] = aliases,
  assertions: TrustAssertionRecord[] = sparkleTrustAssertions,
) {
  expect(matchAppWithIndex(input, createAliasMatchIndex(records, assertions))).toEqual(
    matchApp(input, records, assertions),
  );
}

describe("matchApp", () => {
  it("matches by exact bundle ID", () => {
    const result = matchApp({ appName: "Firefox", bundleId: "org.mozilla.firefox" }, aliases);
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_firefox");
    expect(result.method).toBe("exact_bundle_id");
    expect(result.confidence).toBe(100);
  });

  it("matches case-insensitively by bundle ID", () => {
    const result = matchApp({ appName: "VS Code", bundleId: "com.microsoft.VSCode" }, aliases);
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_vscode");
  });

  it("falls back to name alias", () => {
    const result = matchApp({ appName: "Firefox" }, aliases);
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_firefox");
    expect(result.method).toBe("alias_name");
  });

  it("returns no match for unknown app", () => {
    const result = matchApp({ appName: "Unknown App", bundleId: "com.unknown.app" }, aliases);
    expect(result.matched).toBe(false);
    expect(result.appId).toBeNull();
  });

  it("matches by team ID + name", () => {
    const result = matchApp({ appName: "Firefox", teamId: "43AQ936H96" }, aliases);
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_firefox");
    expect(result.method).toBe("team_id_name");
  });

  it("matches by Mac App Store Adam ID", () => {
    const result = matchApp({ appName: "Firefox", masAppId: "989804926" }, aliases);
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_firefox");
    expect(result.method).toBe("mas_app_id");
  });

  it("matches by Electron update URL", () => {
    const result = matchApp(
      {
        appName: "Visual Studio Code",
        electronUpdateUrl: "https://updates.example.com/vscode",
      },
      aliases,
    );
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_vscode");
    expect(result.method).toBe("electron_update_url");
  });

  it("matches by Homebrew cask token", () => {
    const result = matchApp({ appName: "Firefox", homebrewCaskToken: "firefox" }, aliases);
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_firefox");
    expect(result.method).toBe("homebrew_cask");
  });

  it("normalizes Electron update URLs before matching", () => {
    const result = matchApp(
      {
        appName: "Visual Studio Code",
        electronUpdateUrl: " HTTPS://UPDATES.EXAMPLE.COM/VSCODE ",
      },
      aliases,
    );
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_vscode");
    expect(result.method).toBe("electron_update_url");
  });

  it("keeps exact bundle ID precedence over lower-confidence exact aliases", () => {
    const result = matchApp(
      {
        appName: "Firefox",
        bundleId: "org.mozilla.firefox",
        masAppId: "409201541",
      },
      aliases,
    );
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_firefox");
    expect(result.method).toBe("exact_bundle_id");
    expect(result.ambiguous).toBe(false);
  });

  it("uses matching Sparkle public keys to break low-confidence ambiguity", () => {
    const result = matchApp(
      {
        appName: "Firefox",
        sparklePublicKey: " abc123+/= ",
      },
      [
        {
          appId: "app_firefox",
          appName: "Firefox",
          aliasType: "name",
          value: "Firefox",
          normalizedValue: "firefox",
          isExact: false,
          confidenceWeight: 60,
        },
        {
          appId: "app_other",
          appName: "Firefox ESR",
          aliasType: "name",
          value: "Firefox",
          normalizedValue: "firefox",
          isExact: false,
          confidenceWeight: 60,
        },
      ],
      [
        ...sparkleTrustAssertions,
        {
          appId: "app_other",
          assertionType: "sparkle_public_key",
          value: "different-key",
        },
      ],
    );

    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_firefox");
    expect(result.method).toBe("alias_name");
    expect(result.ambiguous).toBe(false);
    expect(result.confidence).toBe(72);
  });

  it("does not use Sparkle public keys as a standalone match key", () => {
    const result = matchApp(
      {
        appName: "Unknown Browser",
        sparklePublicKey: "abc123+/=",
      },
      aliases,
      sparkleTrustAssertions,
    );

    expect(result.matched).toBe(false);
    expect(result.appId).toBeNull();
  });

  it("keeps indexed matching equivalent to linear matching", () => {
    const ambiguousAliases: AliasRecord[] = [
      {
        appId: "app_firefox",
        appName: "Firefox",
        aliasType: "name",
        value: "Firefox",
        normalizedValue: "firefox",
        isExact: false,
        confidenceWeight: 60,
      },
      {
        appId: "app_other",
        appName: "Firefox ESR",
        aliasType: "name",
        value: "Firefox",
        normalizedValue: "firefox",
        isExact: false,
        confidenceWeight: 55,
      },
    ];

    expectIndexedMatchToEqualLinear({
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
    });
    expectIndexedMatchToEqualLinear({ appName: "Firefox" });
    expectIndexedMatchToEqualLinear({ appName: "Firefox", teamId: "43AQ936H96" });
    expectIndexedMatchToEqualLinear({
      appName: "Firefox",
      sparkleFeedUrl: "https://example.com/firefox/appcast.xml",
    });
    expectIndexedMatchToEqualLinear({ appName: "Firefox", masAppId: "989804926" });
    expectIndexedMatchToEqualLinear({
      appName: "Visual Studio Code",
      electronUpdateUrl: "https://updates.example.com/vscode",
    });
    expectIndexedMatchToEqualLinear({ appName: "Firefox", homebrewCaskToken: "firefox" });
    expectIndexedMatchToEqualLinear({ appName: "Firefox" }, ambiguousAliases, []);
    expectIndexedMatchToEqualLinear(
      { appName: "Firefox", sparklePublicKey: "abc123+/=" },
      ambiguousAliases,
      sparkleTrustAssertions,
    );
  });
});
