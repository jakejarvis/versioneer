import { describe, it, expect } from "vitest";

import { macAppStoreParser } from "../mac-app-store";

const SAMPLE_RESPONSE = JSON.stringify({
  resultCount: 1,
  results: [
    {
      trackId: 803453959,
      bundleId: "com.tinyspeck.slackmacgap",
      trackName: "Slack for Desktop",
      version: "4.48.102",
      currentVersionReleaseDate: "2026-03-19T15:37:31Z",
      releaseNotes: "Bug fixes and performance improvements.",
      minimumOsVersion: "12.0",
      fileSizeBytes: "155188296",
      price: 0.0,
      formattedPrice: "Free",
      artistName: "Slack Technologies, Inc.",
      sellerUrl: "https://slack.com",
      trackViewUrl: "https://apps.apple.com/us/app/slack-for-desktop/id803453959",
      artworkUrl512: "https://is1-ssl.mzstatic.com/image/thumb/icon.png/512x512bb.jpg",
      kind: "mac-software",
    },
  ],
});

const EMPTY_RESPONSE = JSON.stringify({
  resultCount: 0,
  results: [],
});

const IOS_APP_RESPONSE = JSON.stringify({
  resultCount: 1,
  results: [
    {
      trackId: 12345,
      bundleId: "com.example.iosapp",
      trackName: "iOS App",
      version: "2.0.0",
      kind: "software",
      trackViewUrl: "https://apps.apple.com/us/app/ios-app/id12345",
    },
  ],
});

const MIXED_RESULTS_RESPONSE = JSON.stringify({
  resultCount: 2,
  results: [
    {
      trackId: 11111,
      bundleId: "com.example.app",
      trackName: "iOS Version",
      version: "1.0.0",
      kind: "software",
      trackViewUrl: "https://apps.apple.com/us/app/app/id11111",
    },
    {
      trackId: 22222,
      bundleId: "com.example.app",
      trackName: "Mac Version",
      version: "2.0.0",
      kind: "mac-software",
      currentVersionReleaseDate: "2026-01-15T10:00:00Z",
      trackViewUrl: "https://apps.apple.com/us/app/app/id22222",
      minimumOsVersion: "13.0",
    },
  ],
});

const NO_VERSION_RESPONSE = JSON.stringify({
  resultCount: 1,
  results: [
    {
      trackId: 99999,
      bundleId: "com.example.noversionapp",
      trackName: "No Version App",
      kind: "mac-software",
    },
  ],
});

describe("macAppStoreParser", () => {
  it("parses a standard MAS app response", () => {
    const result = macAppStoreParser.parse(SAMPLE_RESPONSE);
    expect(result.releases).toHaveLength(1);
    expect(result.confidence).toBe(90);
    expect(result.errors).toHaveLength(0);
  });

  it("extracts version and channel correctly", () => {
    const result = macAppStoreParser.parse(SAMPLE_RESPONSE);
    const release = result.releases[0]!;
    expect(release.versionRaw).toBe("4.48.102");
    expect(release.channel).toBe("stable");
    expect(release.isPrerelease).toBe(false);
  });

  it("extracts release notes and publish date", () => {
    const result = macAppStoreParser.parse(SAMPLE_RESPONSE);
    const release = result.releases[0]!;
    expect(release.releaseNotesBody).toBe("Bug fixes and performance improvements.");
    expect(release.releaseNotesFormat).toBe("markdown");
    expect(release.publishedAt).toBe("2026-03-19T15:37:31Z");
  });

  it("creates a mac_app_store artifact with App Store URL", () => {
    const result = macAppStoreParser.parse(SAMPLE_RESPONSE);
    const artifacts = result.releases[0]!.artifacts;
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0]!.type).toBe("mac_app_store");
    expect(artifacts[0]!.url).toBe("https://apps.apple.com/us/app/slack-for-desktop/id803453959");
    expect(artifacts[0]!.sizeBytes).toBe(155188296);
    expect(artifacts[0]!.minOsVersion).toBe("12.0");
  });

  it("stores metadata including trackId and artist", () => {
    const result = macAppStoreParser.parse(SAMPLE_RESPONSE);
    const meta = result.releases[0]!.metadata!;
    expect(meta.trackId).toBe(803453959);
    expect(meta.artistName).toBe("Slack Technologies, Inc.");
    expect(meta.trackName).toBe("Slack for Desktop");
    expect(meta.bundleId).toBe("com.tinyspeck.slackmacgap");
    expect(meta.price).toBe(0.0);
    expect(meta.formattedPrice).toBe("Free");
  });

  it("returns zero releases for empty results", () => {
    const result = macAppStoreParser.parse(EMPTY_RESPONSE);
    expect(result.releases).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("No results");
  });

  it("falls back to first result when no mac-software kind found", () => {
    const result = macAppStoreParser.parse(IOS_APP_RESPONSE);
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("2.0.0");
  });

  it("prefers mac-software result in mixed responses", () => {
    const result = macAppStoreParser.parse(MIXED_RESULTS_RESPONSE);
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("2.0.0");
    expect(result.releases[0]!.metadata!.trackName).toBe("Mac Version");
  });

  it("returns zero releases when version field is missing", () => {
    const result = macAppStoreParser.parse(NO_VERSION_RESPONSE);
    expect(result.releases).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.errors[0]).toContain("version");
  });

  it("handles invalid JSON", () => {
    const result = macAppStoreParser.parse("not valid json");
    expect(result.releases).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("handles null/undefined body fields gracefully", () => {
    const response = JSON.stringify({
      resultCount: 1,
      results: [
        {
          trackId: 1,
          bundleId: "com.example.minimal",
          trackName: "Minimal App",
          version: "1.0",
          kind: "mac-software",
        },
      ],
    });
    const result = macAppStoreParser.parse(response);
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.artifacts).toHaveLength(0);
    expect(result.releases[0]!.releaseNotesBody).toBeUndefined();
    expect(result.releases[0]!.publishedAt).toBeUndefined();
  });
});
