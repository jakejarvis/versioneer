import { describe, it, expect } from "vitest";

import { homebrewCaskParser } from "../homebrew-cask";

const SAMPLE_CASK = JSON.stringify({
  token: "iterm2",
  version: "3.5.13",
  sha256: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
  url: "https://iterm2.com/downloads/stable/iTerm2-3_5_13.zip",
  name: ["iTerm2"],
  desc: "Terminal emulator as alternative to Apple's Terminal app",
  homepage: "https://iterm2.com/",
  container: null,
  auto_updates: true,
  depends_on: {
    macos: { ">=": ["12"] },
  },
  artifacts: [{ app: ["iTerm.app"] }],
});

const SAMPLE_CASK_DMG = JSON.stringify({
  token: "1password",
  version: "8.10.60",
  sha256: "deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
  url: "https://downloads.1password.com/mac/1Password-8.10.60.dmg",
  name: ["1Password"],
  homepage: "https://1password.com/",
  container: null,
  auto_updates: false,
  artifacts: [{ app: ["1Password.app"] }],
});

const SAMPLE_CASK_NO_CHECK = JSON.stringify({
  token: "google-chrome",
  version: "131.0.6778.86",
  sha256: "no_check",
  url: "https://dl.google.com/chrome/mac/universal/stable/GGRO/googlechrome.dmg",
  name: ["Google Chrome"],
  homepage: "https://www.google.com/chrome/",
  auto_updates: true,
});

const SAMPLE_CASK_LATEST = JSON.stringify({
  token: "some-app",
  version: "latest",
  sha256: "no_check",
  url: "https://example.com/download",
  name: ["Some App"],
});

const SAMPLE_CASK_VARIATIONS = JSON.stringify({
  token: "visual-studio-code",
  version: "1.95.3",
  sha256: "abc123",
  url: "https://update.code.visualstudio.com/1.95.3/darwin-arm64/stable",
  name: ["Visual Studio Code"],
  homepage: "https://code.visualstudio.com/",
  auto_updates: true,
  variations: {
    arm64_ventura: {
      url: "https://update.code.visualstudio.com/1.95.3/darwin-arm64/stable",
      sha256: "abc123",
    },
    intel_ventura: {
      url: "https://update.code.visualstudio.com/1.95.3/darwin/stable",
      sha256: "def456",
    },
  },
});

const SAMPLE_CASK_PKG = JSON.stringify({
  token: "microsoft-office",
  version: "16.91.24111020",
  sha256: "feedface",
  url: "https://officecdn.microsoft.com/Office-16.91.24111020.pkg",
  name: ["Microsoft Office"],
  homepage: "https://www.microsoft.com/office",
  container: "pkg",
});

describe("homebrewCaskParser", () => {
  it("parses a standard cask with version and artifact", () => {
    const result = homebrewCaskParser.parse(SAMPLE_CASK);
    expect(result.releases).toHaveLength(1);
    expect(result.confidence).toBe(80);
    expect(result.errors).toHaveLength(0);
  });

  it("extracts version correctly", () => {
    const result = homebrewCaskParser.parse(SAMPLE_CASK);
    expect(result.releases[0]!.versionRaw).toBe("3.5.13");
    expect(result.releases[0]!.channel).toBe("stable");
    expect(result.releases[0]!.isPrerelease).toBe(false);
  });

  it("creates artifact with SHA256", () => {
    const result = homebrewCaskParser.parse(SAMPLE_CASK);
    expect(result.releases[0]!.artifacts).toHaveLength(1);
    const artifact = result.releases[0]!.artifacts[0]!;
    expect(artifact.url).toBe("https://iterm2.com/downloads/stable/iTerm2-3_5_13.zip");
    expect(artifact.type).toBe("zip");
    expect(artifact.sha256).toBe(
      "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
    );
  });

  it("infers dmg artifact type from URL", () => {
    const result = homebrewCaskParser.parse(SAMPLE_CASK_DMG);
    expect(result.releases[0]!.artifacts[0]!.type).toBe("dmg");
  });

  it("infers pkg artifact type from container field", () => {
    const result = homebrewCaskParser.parse(SAMPLE_CASK_PKG);
    expect(result.releases[0]!.artifacts[0]!.type).toBe("pkg");
  });

  it("handles sha256: no_check", () => {
    const result = homebrewCaskParser.parse(SAMPLE_CASK_NO_CHECK);
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.artifacts[0]!.sha256).toBeUndefined();
  });

  it("returns zero confidence for version: latest", () => {
    const result = homebrewCaskParser.parse(SAMPLE_CASK_LATEST);
    expect(result.releases).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("latest");
  });

  it("extracts minOsVersion from depends_on", () => {
    const result = homebrewCaskParser.parse(SAMPLE_CASK);
    expect(result.releases[0]!.artifacts[0]!.minOsVersion).toBe("12");
  });

  it("stores metadata including cask token and auto_updates", () => {
    const result = homebrewCaskParser.parse(SAMPLE_CASK);
    const meta = result.releases[0]!.metadata!;
    expect(meta.homebrewCaskToken).toBe("iterm2");
    expect(meta.autoUpdates).toBe(true);
    expect(meta.homepage).toBe("https://iterm2.com/");
  });

  it("handles architecture variations", () => {
    const result = homebrewCaskParser.parse(SAMPLE_CASK_VARIATIONS);
    // Primary artifact + intel variation (arm64 variation has same URL as primary so is skipped)
    const artifacts = result.releases[0]!.artifacts;
    expect(artifacts.length).toBeGreaterThanOrEqual(1);
    const intel = artifacts.find((a) => a.architecture === "x86_64");
    expect(intel).toBeDefined();
    expect(intel!.sha256).toBe("def456");
  });

  it("handles invalid JSON", () => {
    const result = homebrewCaskParser.parse("not json");
    expect(result.releases).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("handles comma-separated version (version,build)", () => {
    const cask = JSON.stringify({
      token: "some-app",
      version: "1.2.3,456",
      sha256: "abcdef",
      url: "https://example.com/app.dmg",
    });
    const result = homebrewCaskParser.parse(cask);
    expect(result.releases[0]!.versionRaw).toBe("1.2.3");
  });
});
