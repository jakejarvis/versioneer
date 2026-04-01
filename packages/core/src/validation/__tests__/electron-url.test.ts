import { describe, expect, it } from "vitest";

import {
  buildElectronFeedCandidates,
  canonicalizeElectronBaseUrl,
  resolveElectronArtifactBase,
} from "../electron-url";

describe("canonicalizeElectronBaseUrl", () => {
  it("normalizes a bare GitHub repo URL", () => {
    expect(canonicalizeElectronBaseUrl("https://github.com/owner/repo")).toBe(
      "https://github.com/owner/repo/releases",
    );
  });

  it("normalizes a GitHub /releases URL", () => {
    expect(canonicalizeElectronBaseUrl("https://github.com/owner/repo/releases")).toBe(
      "https://github.com/owner/repo/releases",
    );
  });

  it("normalizes a GitHub /releases/latest URL", () => {
    expect(canonicalizeElectronBaseUrl("https://github.com/owner/repo/releases/latest")).toBe(
      "https://github.com/owner/repo/releases",
    );
  });

  it("passes through a generic URL unchanged", () => {
    expect(canonicalizeElectronBaseUrl("https://example.com/update")).toBe(
      "https://example.com/update",
    );
  });

  it("passes through a direct yml URL unchanged", () => {
    expect(canonicalizeElectronBaseUrl("https://example.com/update/latest-mac.yml")).toBe(
      "https://example.com/update/latest-mac.yml",
    );
  });
});

describe("resolveElectronArtifactBase", () => {
  it("returns the GitHub release download prefix for a canonical GitHub URL", () => {
    expect(resolveElectronArtifactBase("https://github.com/owner/repo/releases")).toBe(
      "https://github.com/owner/repo/releases/latest/download",
    );
  });

  it("returns the GitHub release download prefix for a bare repo URL", () => {
    expect(resolveElectronArtifactBase("https://github.com/owner/repo")).toBe(
      "https://github.com/owner/repo/releases/latest/download",
    );
  });

  it("passes through a generic URL unchanged", () => {
    expect(resolveElectronArtifactBase("https://example.com/update")).toBe(
      "https://example.com/update",
    );
  });
});

describe("resolveElectronArtifactBase + parser artifact resolution", () => {
  it("produces a valid download URL for a GitHub-hosted Electron app", () => {
    // Simulates what the parser does: resolveArtifactUrl(config.sourceBaseUrl, path)
    const userInput = "https://github.com/pingdotgg/t3code";
    const canonicalized = canonicalizeElectronBaseUrl(userInput);
    const artifactBase = resolveElectronArtifactBase(canonicalized);
    const relativePath = "T3-Code-2.4.1-mac.zip";

    // Same logic as parsers/electron-generic.ts resolveArtifactUrl
    const normalizedBase = artifactBase.endsWith("/") ? artifactBase : `${artifactBase}/`;
    const artifactUrl = `${normalizedBase}${relativePath}`;

    expect(artifactUrl).toBe(
      "https://github.com/pingdotgg/t3code/releases/latest/download/T3-Code-2.4.1-mac.zip",
    );
  });

  it("produces a valid download URL for a generic Electron feed", () => {
    const userInput = "https://example.com/update";
    const canonicalized = canonicalizeElectronBaseUrl(userInput);
    const artifactBase = resolveElectronArtifactBase(canonicalized);
    const relativePath = "App-1.0.0-mac.zip";

    const normalizedBase = artifactBase.endsWith("/") ? artifactBase : `${artifactBase}/`;
    const artifactUrl = `${normalizedBase}${relativePath}`;

    expect(artifactUrl).toBe("https://example.com/update/App-1.0.0-mac.zip");
  });
});

describe("canonicalize + alias matching (desktop compatibility)", () => {
  it("canonical form matches what the desktop client reports", () => {
    // Desktop BundleMetadataReader.swift reports: https://github.com/{owner}/{repo}/releases
    const desktopReported = "https://github.com/pingdotgg/t3code/releases";

    // User might enter any of these in the dashboard:
    const variants = [
      "https://github.com/pingdotgg/t3code",
      "https://github.com/pingdotgg/t3code/releases",
      "https://github.com/pingdotgg/t3code/releases/latest",
    ];

    for (const variant of variants) {
      const canonical = canonicalizeElectronBaseUrl(variant);
      expect(canonical.toLowerCase()).toBe(desktopReported.toLowerCase());
    }
  });
});

describe("buildElectronFeedCandidates", () => {
  it("returns direct URL when it already ends with latest-mac.yml", () => {
    const url = "https://example.com/update/latest-mac.yml";
    expect(buildElectronFeedCandidates(url)).toEqual([url]);
  });

  it("returns direct URL when it already ends with latest.yml", () => {
    const url = "https://example.com/update/latest.yml";
    expect(buildElectronFeedCandidates(url)).toEqual([url]);
  });

  it("appends candidate filenames to a generic base URL", () => {
    expect(buildElectronFeedCandidates("https://example.com/update")).toEqual([
      "https://example.com/update/latest-mac.yml",
      "https://example.com/update/latest.yml",
    ]);
  });

  it("handles trailing slash on generic base URL", () => {
    expect(buildElectronFeedCandidates("https://example.com/update/")).toEqual([
      "https://example.com/update/latest-mac.yml",
      "https://example.com/update/latest.yml",
    ]);
  });

  it("rewrites a GitHub repo URL to release download paths", () => {
    expect(buildElectronFeedCandidates("https://github.com/pingdotgg/t3code")).toEqual([
      "https://github.com/pingdotgg/t3code/releases/latest/download/latest-mac.yml",
      "https://github.com/pingdotgg/t3code/releases/latest/download/latest.yml",
    ]);
  });

  it("rewrites a GitHub releases page URL to release download paths", () => {
    expect(buildElectronFeedCandidates("https://github.com/pingdotgg/t3code/releases")).toEqual([
      "https://github.com/pingdotgg/t3code/releases/latest/download/latest-mac.yml",
      "https://github.com/pingdotgg/t3code/releases/latest/download/latest.yml",
    ]);
  });

  it("rewrites a GitHub releases/latest URL to release download paths", () => {
    expect(
      buildElectronFeedCandidates("https://github.com/pingdotgg/t3code/releases/latest"),
    ).toEqual([
      "https://github.com/pingdotgg/t3code/releases/latest/download/latest-mac.yml",
      "https://github.com/pingdotgg/t3code/releases/latest/download/latest.yml",
    ]);
  });

  it("works with the canonical form from canonicalizeElectronBaseUrl", () => {
    const canonical = canonicalizeElectronBaseUrl("https://github.com/owner/repo");
    expect(buildElectronFeedCandidates(canonical)).toEqual([
      "https://github.com/owner/repo/releases/latest/download/latest-mac.yml",
      "https://github.com/owner/repo/releases/latest/download/latest.yml",
    ]);
  });
});
