import { describe, it, expect } from "vitest";
import { matchApp } from "../matcher";
import type { AliasRecord } from "../types";

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
];

describe("matchApp", () => {
  it("matches by exact bundle ID", () => {
    const result = matchApp(
      { appName: "Firefox", bundleId: "org.mozilla.firefox" },
      aliases,
    );
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_firefox");
    expect(result.method).toBe("exact_bundle_id");
    expect(result.confidence).toBe(100);
  });

  it("matches case-insensitively by bundle ID", () => {
    const result = matchApp(
      { appName: "VS Code", bundleId: "com.microsoft.VSCode" },
      aliases,
    );
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
    const result = matchApp(
      { appName: "Unknown App", bundleId: "com.unknown.app" },
      aliases,
    );
    expect(result.matched).toBe(false);
    expect(result.appId).toBeNull();
  });

  it("matches by team ID + name", () => {
    const result = matchApp(
      { appName: "Firefox", teamId: "43AQ936H96" },
      aliases,
    );
    expect(result.matched).toBe(true);
    expect(result.appId).toBe("app_firefox");
    expect(result.method).toBe("team_id_name");
  });
});
