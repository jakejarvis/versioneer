import { describe, expect, it } from "vite-plus/test";

import { electronGenericParser } from "../electron-generic";

const SAMPLE_FEED = `
version: 2.4.1
filesize: 123456
sha512: abc123
releaseDate: 2026-03-28T12:00:00.000Z
path: releases/Example-2.4.1-mac.zip
releaseName: Example 2.4.1
`;

describe("electronGenericParser", () => {
  it("parses latest-mac.yml feeds and resolves relative artifact URLs", () => {
    const result = electronGenericParser.parse(SAMPLE_FEED, {
      sourceBaseUrl: "https://downloads.example.com/app/",
    });

    expect(result.errors).toEqual([]);
    expect(result.releases).toHaveLength(1);
    expect(result.confidence).toBe(82);
    expect(result.releases[0]?.versionRaw).toBe("2.4.1");
    expect(result.releases[0]?.artifacts[0]).toEqual(
      expect.objectContaining({
        url: "https://downloads.example.com/app/releases/Example-2.4.1-mac.zip",
        type: "zip",
        signature: "abc123",
        sizeBytes: 123456,
      }),
    );
  });

  it("returns a parse error when version is missing", () => {
    const result = electronGenericParser.parse("path: release.zip");

    expect(result.releases).toEqual([]);
    expect(result.confidence).toBe(0);
    expect(result.errors[0]).toContain("Missing version");
  });

  it("preserves split files from latest-mac.yml feeds", () => {
    const result = electronGenericParser.parse(
      `
version: 3.1.0
files:
  - url: Example-3.1.0-arm64.dmg
    sha512: arm512
    size: 1000
  - url: Example-3.1.0-x64.dmg
    sha512: x64512
    size: 1100
path: Example-3.1.0-arm64.dmg
sha512: fallback
releaseDate: 2026-03-28T12:00:00.000Z
`,
      { sourceBaseUrl: "https://downloads.example.com/app/" },
    );

    expect(result.errors).toEqual([]);
    expect(result.releases[0]!.artifacts).toHaveLength(2);
    expect(result.releases[0]!.artifacts).toEqual([
      expect.objectContaining({
        url: "https://downloads.example.com/app/Example-3.1.0-arm64.dmg",
        architecture: "arm64",
        signature: "arm512",
        sizeBytes: 1000,
      }),
      expect.objectContaining({
        url: "https://downloads.example.com/app/Example-3.1.0-x64.dmg",
        architecture: "x86_64",
        signature: "x64512",
        sizeBytes: 1100,
      }),
    ]);
  });
});
