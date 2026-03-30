import { describe, it, expect } from "vitest";

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
});
