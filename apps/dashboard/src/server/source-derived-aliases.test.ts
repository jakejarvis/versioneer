import { describe, expect, it } from "vite-plus/test";

import { shouldKeepDerivedSourceAlias } from "./source-derived-aliases";

describe("shouldKeepDerivedSourceAlias", () => {
  it("keeps the currently-derived alias", () => {
    expect(
      shouldKeepDerivedSourceAlias(
        { aliasType: "github_repo", normalizedValue: "owner/repo" },
        { aliasType: "github_repo", normalizedValue: "owner/repo" },
      ),
    ).toBe(true);
  });

  it("drops stale aliases when the derived alias changes", () => {
    expect(
      shouldKeepDerivedSourceAlias(
        { aliasType: "github_repo", normalizedValue: "owner/repo" },
        { aliasType: "homepage", normalizedValue: "https://example.com" },
      ),
    ).toBe(false);
    expect(
      shouldKeepDerivedSourceAlias(
        { aliasType: "github_repo", normalizedValue: "owner/repo" },
        { aliasType: "github_repo", normalizedValue: "owner/other" },
      ),
    ).toBe(false);
  });

  it("drops all owned aliases when a source no longer derives one", () => {
    expect(
      shouldKeepDerivedSourceAlias(
        { aliasType: "electron_update_url", normalizedValue: "https://example.com/latest.yml" },
        null,
      ),
    ).toBe(false);
  });
});
