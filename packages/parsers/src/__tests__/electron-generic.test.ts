import { describe, expect, it } from "vitest";

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
});
