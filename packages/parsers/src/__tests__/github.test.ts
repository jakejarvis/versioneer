import { describe, it, expect } from "vitest";
import { githubReleasesParser } from "../github";

const SAMPLE_RELEASES = JSON.stringify([
  {
    tag_name: "v3.0.0",
    name: "Release 3.0.0",
    prerelease: false,
    draft: false,
    published_at: "2024-01-15T12:00:00Z",
    html_url: "https://github.com/example/app/releases/tag/v3.0.0",
    assets: [
      {
        name: "App-3.0.0-mac.dmg",
        browser_download_url: "https://github.com/example/app/releases/download/v3.0.0/App-3.0.0-mac.dmg",
        size: 20000000,
        content_type: "application/octet-stream",
      },
      {
        name: "App-3.0.0-arm64.dmg",
        browser_download_url: "https://github.com/example/app/releases/download/v3.0.0/App-3.0.0-arm64.dmg",
        size: 18000000,
        content_type: "application/octet-stream",
      },
      {
        name: "App-3.0.0-linux.tar.gz",
        browser_download_url: "https://github.com/example/app/releases/download/v3.0.0/App-3.0.0-linux.tar.gz",
        size: 15000000,
        content_type: "application/gzip",
      },
    ],
  },
  {
    tag_name: "v3.0.0-beta.1",
    name: "Release 3.0.0-beta.1",
    prerelease: true,
    draft: false,
    published_at: "2024-01-10T12:00:00Z",
    html_url: "https://github.com/example/app/releases/tag/v3.0.0-beta.1",
    assets: [],
  },
  {
    tag_name: "v2.9.0-draft",
    name: "Draft",
    prerelease: false,
    draft: true,
    published_at: null,
    assets: [],
  },
]);

describe("githubReleasesParser", () => {
  it("parses releases, skipping drafts", () => {
    const result = githubReleasesParser.parse(SAMPLE_RELEASES);
    expect(result.releases).toHaveLength(2);
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("strips v prefix from version", () => {
    const result = githubReleasesParser.parse(SAMPLE_RELEASES);
    expect(result.releases[0]!.versionRaw).toBe("3.0.0");
  });

  it("identifies prerelease", () => {
    const result = githubReleasesParser.parse(SAMPLE_RELEASES);
    expect(result.releases[0]!.isPrerelease).toBe(false);
    expect(result.releases[1]!.isPrerelease).toBe(true);
  });

  it("filters mac artifacts", () => {
    const result = githubReleasesParser.parse(SAMPLE_RELEASES);
    // Should have 2 mac artifacts (dmg files), not the linux tar.gz
    expect(result.releases[0]!.artifacts).toHaveLength(2);
  });

  it("infers architecture", () => {
    const result = githubReleasesParser.parse(SAMPLE_RELEASES);
    const arm64Artifact = result.releases[0]!.artifacts.find(
      (a) => a.architecture === "arm64",
    );
    expect(arm64Artifact).toBeDefined();
  });

  it("handles invalid JSON", () => {
    const result = githubReleasesParser.parse("not json");
    expect(result.releases).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });
});
