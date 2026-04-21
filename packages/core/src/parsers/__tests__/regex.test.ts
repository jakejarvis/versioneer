import { describe, it, expect } from "vite-plus/test";

import { regexParser } from "../regex";

const PLIST_BODY = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>BundleVersion</key>
  <string>7172</string>
  <key>BundleShortVersionString</key>
  <string>6.3.3</string>
  <key>DownloadURL</key>
  <string>https://www.obdev.at/downloads/littlesnitch/LittleSnitch-6.3.3.dmg</string>
  <key>ReleaseNotesURL</key>
  <string>https://www.obdev.at/products/littlesnitch/releasenotes6.html</string>
</dict>
</plist>`;

describe("regexParser", () => {
  it("extracts version from capture group 1", () => {
    const result = regexParser.parse("App version 3.2.1 released", {
      versionPattern: "version\\s+([\\d.]+)",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("3.2.1");
    expect(result.releases[0]!.channel).toBe("stable");
    expect(result.confidence).toBe(40);
    expect(result.errors).toHaveLength(0);
  });

  it("extracts version and download URL", () => {
    const body = "Download MyApp-2.0.0.dmg from https://example.com/MyApp-2.0.0.dmg today!";
    const result = regexParser.parse(body, {
      versionPattern: "MyApp-([\\d.]+)\\.dmg",
      downloadPattern: "(https://[^\\s]+\\.dmg)",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("2.0.0");
    expect(result.releases[0]!.downloadUrl).toBe("https://example.com/MyApp-2.0.0.dmg");
    expect(result.releases[0]!.artifacts).toHaveLength(1);
    expect(result.releases[0]!.artifacts[0]!.type).toBe("dmg");
    expect(result.confidence).toBe(60);
  });

  it("supports case-insensitive flag", () => {
    const result = regexParser.parse("VERSION 1.5.0 available", {
      versionPattern: "version\\s+([\\d.]+)",
      flags: "i",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("1.5.0");
  });

  it("falls back to match[0] when no capture group", () => {
    const result = regexParser.parse("Current: 4.1.2", {
      versionPattern: "\\d+\\.\\d+\\.\\d+",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("4.1.2");
  });

  it("returns error when versionPattern is missing", () => {
    const result = regexParser.parse("some body", {});
    expect(result.releases).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.errors[0]).toContain("versionPattern");
  });

  it("returns error for invalid regex", () => {
    const result = regexParser.parse("some body", {
      versionPattern: "([",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.errors[0]).toContain("Invalid versionPattern regex");
  });

  it("returns error for invalid downloadPattern regex", () => {
    const result = regexParser.parse("version 1.0", {
      versionPattern: "([\\d.]+)",
      downloadPattern: "([",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("Invalid downloadPattern regex");
  });

  it("returns error when pattern does not match", () => {
    const result = regexParser.parse("no version here", {
      versionPattern: "v([\\d.]+)",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("did not match");
  });

  it("returns error for empty body", () => {
    const result = regexParser.parse("", {
      versionPattern: "([\\d.]+)",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("empty");
  });

  it("resolves relative download URL against sourceBaseUrl", () => {
    const result = regexParser.parse("v1.0 at /downloads/app.pkg", {
      versionPattern: "v([\\d.]+)",
      downloadPattern: "(/downloads/[^\\s]+)",
      sourceBaseUrl: "https://example.com",
    });
    expect(result.releases[0]!.downloadUrl).toBe("https://example.com/downloads/app.pkg");
    expect(result.releases[0]!.artifacts[0]!.type).toBe("pkg");
  });

  it("detects prerelease versions", () => {
    const result = regexParser.parse("latest: 2.0.0-beta.1", {
      versionPattern: "latest:\\s+([\\d.]+[\\w.-]*)",
    });
    expect(result.releases[0]!.isPrerelease).toBe(true);
    expect(result.releases[0]!.channel).toBe("beta");
  });

  it("extracts version from real-world plist body", () => {
    const result = regexParser.parse(PLIST_BODY, {
      versionPattern: "LittleSnitch-([\\d.]+)\\.dmg",
      downloadPattern: "(https://[^<]+\\.dmg)",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("6.3.3");
    expect(result.releases[0]!.downloadUrl).toBe(
      "https://www.obdev.at/downloads/littlesnitch/LittleSnitch-6.3.3.dmg",
    );
    expect(result.confidence).toBe(60);
  });

  it("stores config in metadata", () => {
    const result = regexParser.parse("v1.0", {
      versionPattern: "v([\\d.]+)",
      flags: "i",
    });
    const meta = result.releases[0]!.metadata!;
    expect(meta.versionPattern).toBe("v([\\d.]+)");
    expect(meta.flags).toBe("i");
    expect(meta.downloadPattern).toBeNull();
  });

  it("ignores download when downloadPattern does not match", () => {
    const result = regexParser.parse("version 1.0", {
      versionPattern: "version\\s+([\\d.]+)",
      downloadPattern: "(https://[^\\s]+\\.dmg)",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.downloadUrl).toBeUndefined();
    expect(result.releases[0]!.artifacts).toHaveLength(0);
    expect(result.confidence).toBe(40);
  });
});
