import { describe, it, expect } from "vite-plus/test";

import { jsonParser } from "../json";

const SIMPLE_JSON = JSON.stringify({
  version: "2.5.0",
  download_url: "https://example.com/app-2.5.0.dmg",
});

const NESTED_JSON = JSON.stringify({
  app: {
    latest: {
      version: "1.3.7",
      assets: [
        { name: "App-1.3.7.dmg", url: "https://example.com/App-1.3.7.dmg" },
        { name: "App-1.3.7.zip", url: "https://example.com/App-1.3.7.zip" },
      ],
    },
  },
});

const ARRAY_JSON = JSON.stringify([
  { version: "3.0.0", url: "https://example.com/v3.dmg" },
  { version: "2.9.0", url: "https://example.com/v2.dmg" },
]);

describe("jsonParser", () => {
  it("extracts version from a simple path", () => {
    const result = jsonParser.parse(SIMPLE_JSON, {
      versionPath: "$.version",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("2.5.0");
    expect(result.confidence).toBe(50);
    expect(result.errors).toHaveLength(0);
  });

  it("extracts version and download URL", () => {
    const result = jsonParser.parse(SIMPLE_JSON, {
      versionPath: "$.version",
      downloadPath: "$.download_url",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("2.5.0");
    expect(result.releases[0]!.downloadUrl).toBe("https://example.com/app-2.5.0.dmg");
    expect(result.releases[0]!.artifacts).toHaveLength(1);
    expect(result.releases[0]!.artifacts[0]!.type).toBe("dmg");
    expect(result.confidence).toBe(70);
  });

  it("navigates nested objects", () => {
    const result = jsonParser.parse(NESTED_JSON, {
      versionPath: "$.app.latest.version",
      downloadPath: "$.app.latest.assets[0].url",
    });
    expect(result.releases[0]!.versionRaw).toBe("1.3.7");
    expect(result.releases[0]!.downloadUrl).toBe("https://example.com/App-1.3.7.dmg");
  });

  it("navigates arrays", () => {
    const result = jsonParser.parse(ARRAY_JSON, {
      versionPath: "$[0].version",
      downloadPath: "$[0].url",
    });
    expect(result.releases[0]!.versionRaw).toBe("3.0.0");
    expect(result.releases[0]!.downloadUrl).toBe("https://example.com/v3.dmg");
  });

  it("returns error when versionPath is missing", () => {
    const result = jsonParser.parse(SIMPLE_JSON, {});
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("versionPath");
  });

  it("returns error for invalid JSON body", () => {
    const result = jsonParser.parse("not json {{{", {
      versionPath: "$.version",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("Failed to parse JSON");
  });

  it("returns error when path matches nothing", () => {
    const result = jsonParser.parse(SIMPLE_JSON, {
      versionPath: "$.nonexistent",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("matched no value");
  });

  it("converts numeric values to strings", () => {
    const body = JSON.stringify({ build: 7172 });
    const result = jsonParser.parse(body, {
      versionPath: "$.build",
    });
    expect(result.releases[0]!.versionRaw).toBe("7172");
  });

  it("detects prerelease versions", () => {
    const body = JSON.stringify({ version: "4.0.0-rc.1" });
    const result = jsonParser.parse(body, {
      versionPath: "$.version",
    });
    expect(result.releases[0]!.isPrerelease).toBe(true);
  });

  it("resolves relative download URL against sourceBaseUrl", () => {
    const body = JSON.stringify({ version: "1.0", path: "/dl/app.pkg" });
    const result = jsonParser.parse(body, {
      versionPath: "$.version",
      downloadPath: "$.path",
      sourceBaseUrl: "https://example.com",
    });
    expect(result.releases[0]!.downloadUrl).toBe("https://example.com/dl/app.pkg");
  });

  it("stores config paths in metadata", () => {
    const result = jsonParser.parse(SIMPLE_JSON, {
      versionPath: "$.version",
      downloadPath: "$.download_url",
    });
    const meta = result.releases[0]!.metadata!;
    expect(meta.versionPath).toBe("$.version");
    expect(meta.downloadPath).toBe("$.download_url");
  });

  it("ignores download when downloadPath matches nothing", () => {
    const result = jsonParser.parse(SIMPLE_JSON, {
      versionPath: "$.version",
      downloadPath: "$.nonexistent",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.downloadUrl).toBeUndefined();
    expect(result.confidence).toBe(50);
  });

  describe("multi-release via releasesPath", () => {
    const MULLVAD_STYLE = JSON.stringify({
      signed: {
        releases: [
          {
            version: "2025.5",
            installers: [{ architecture: "arm64", urls: ["https://example.com/2025.5.pkg"] }],
          },
          {
            version: "2025.6-beta1",
            installers: [{ architecture: "arm64", urls: ["https://example.com/2025.6-beta1.pkg"] }],
          },
          {
            version: "2026.1",
            installers: [{ architecture: "arm64", urls: ["https://example.com/2026.1.pkg"] }],
          },
        ],
      },
    });

    it("extracts multiple releases from an array", () => {
      const result = jsonParser.parse(MULLVAD_STYLE, {
        releasesPath: "$.signed.releases[*]",
        versionPath: "$.version",
        downloadPath: "$.installers[0].urls[0]",
      });
      expect(result.releases).toHaveLength(3);
      expect(result.releases[0]!.versionRaw).toBe("2025.5");
      expect(result.releases[0]!.downloadUrl).toBe("https://example.com/2025.5.pkg");
      expect(result.releases[1]!.versionRaw).toBe("2025.6-beta1");
      expect(result.releases[2]!.versionRaw).toBe("2026.1");
      expect(result.confidence).toBe(70);
      expect(result.errors).toHaveLength(0);
    });

    it("infers channels and prerelease flags per release", () => {
      const result = jsonParser.parse(MULLVAD_STYLE, {
        releasesPath: "$.signed.releases[*]",
        versionPath: "$.version",
      });
      expect(result.releases[0]!.channel).toBe("stable");
      expect(result.releases[0]!.isPrerelease).toBe(false);
      expect(result.releases[1]!.channel).toBe("beta");
      expect(result.releases[1]!.isPrerelease).toBe(true);
      expect(result.releases[2]!.channel).toBe("stable");
    });

    it("returns error when releasesPath matches nothing", () => {
      const result = jsonParser.parse(MULLVAD_STYLE, {
        releasesPath: "$.nonexistent[*]",
        versionPath: "$.version",
      });
      expect(result.releases).toHaveLength(0);
      expect(result.errors[0]).toContain("matched no elements");
    });

    it("skips elements with missing version", () => {
      const body = JSON.stringify({
        items: [
          { version: "1.0.0", url: "https://example.com/1.0.0.dmg" },
          { url: "https://example.com/broken.dmg" },
          { version: "2.0.0", url: "https://example.com/2.0.0.dmg" },
        ],
      });
      const result = jsonParser.parse(body, {
        releasesPath: "$.items[*]",
        versionPath: "$.version",
        downloadPath: "$.url",
      });
      expect(result.releases).toHaveLength(2);
      expect(result.releases[0]!.versionRaw).toBe("1.0.0");
      expect(result.releases[1]!.versionRaw).toBe("2.0.0");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("stores releasesPath in metadata", () => {
      const result = jsonParser.parse(MULLVAD_STYLE, {
        releasesPath: "$.signed.releases[*]",
        versionPath: "$.version",
      });
      expect(result.releases[0]!.metadata!.releasesPath).toBe("$.signed.releases[*]");
    });

    it("works with top-level arrays", () => {
      const result = jsonParser.parse(ARRAY_JSON, {
        releasesPath: "$[*]",
        versionPath: "$.version",
        downloadPath: "$.url",
      });
      expect(result.releases).toHaveLength(2);
      expect(result.releases[0]!.versionRaw).toBe("3.0.0");
      expect(result.releases[1]!.versionRaw).toBe("2.9.0");
    });

    it("confidence is 50 without download artifacts", () => {
      const result = jsonParser.parse(MULLVAD_STYLE, {
        releasesPath: "$.signed.releases[*]",
        versionPath: "$.version",
      });
      expect(result.confidence).toBe(50);
    });
  });
});
