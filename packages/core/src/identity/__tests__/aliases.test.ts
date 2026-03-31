import { describe, expect, it } from "vitest";

import { isGloballyUniqueExactAliasType, normalizeAliasValue } from "../aliases";

describe("alias helpers", () => {
  it("normalizes names and bundle identifiers with matcher-compatible rules", () => {
    expect(normalizeAliasValue("name", "  Visual Studio Code.app  ")).toBe("visual studio code");
    expect(normalizeAliasValue("bundle_id", "COM.MICROSOFT.VSCODE")).toBe("com.microsoft.vscode");
    expect(normalizeAliasValue("mas_app_id", " 989804926 ")).toBe("989804926");
    expect(normalizeAliasValue("electron_update_url", " HTTPS://UPDATES.EXAMPLE.COM/VSCODE ")).toBe(
      "https://updates.example.com/vscode",
    );
  });

  it("treats only high-signal exact aliases as globally unique", () => {
    expect(isGloballyUniqueExactAliasType("bundle_id")).toBe(true);
    expect(isGloballyUniqueExactAliasType("sparkle_feed")).toBe(true);
    expect(isGloballyUniqueExactAliasType("mas_app_id")).toBe(true);
    expect(isGloballyUniqueExactAliasType("electron_update_url")).toBe(true);
    expect(isGloballyUniqueExactAliasType("homebrew_cask")).toBe(true);
    expect(isGloballyUniqueExactAliasType("name")).toBe(false);
    expect(isGloballyUniqueExactAliasType("team_id")).toBe(false);
  });
});
