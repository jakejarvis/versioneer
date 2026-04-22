import { describe, expect, it } from "vite-plus/test";

import {
  artifactSupportsTarget,
  normalizeArtifactArchitecture,
  normalizeTargetArchitecture,
  rankArtifactForTarget,
} from "@versioneer/schemas/architecture";

describe("architecture helpers", () => {
  it("normalizes common architecture aliases", () => {
    expect(normalizeArtifactArchitecture("aarch64")).toBe("arm64");
    expect(normalizeArtifactArchitecture("apple-silicon")).toBe("arm64");
    expect(normalizeArtifactArchitecture("x64")).toBe("x86_64");
    expect(normalizeArtifactArchitecture("amd64")).toBe("x86_64");
    expect(normalizeArtifactArchitecture("intel")).toBe("x86_64");
    expect(normalizeArtifactArchitecture("universal2")).toBe("universal");
    expect(normalizeArtifactArchitecture("mips")).toBe("unknown");
  });

  it("normalizes only concrete client targets", () => {
    expect(normalizeTargetArchitecture("arm64")).toBe("arm64");
    expect(normalizeTargetArchitecture("intel")).toBe("x86_64");
    expect(normalizeTargetArchitecture("universal")).toBeNull();
    expect(normalizeTargetArchitecture(undefined)).toBeNull();
  });

  it("allows arm64 to use x86_64 through Rosetta but not the reverse", () => {
    expect(artifactSupportsTarget("x86_64", "arm64")).toBe(true);
    expect(artifactSupportsTarget("arm64", "x86_64")).toBe(false);
    expect(artifactSupportsTarget("universal", "x86_64")).toBe(true);
    expect(artifactSupportsTarget("unknown", "arm64")).toBe(true);
  });

  it("ranks native artifacts ahead of fallbacks", () => {
    expect(rankArtifactForTarget("arm64", "arm64")).toBeGreaterThan(
      rankArtifactForTarget("universal", "arm64"),
    );
    expect(rankArtifactForTarget("universal", "arm64")).toBeGreaterThan(
      rankArtifactForTarget("x86_64", "arm64"),
    );
    expect(rankArtifactForTarget("arm64", "x86_64")).toBe(-1);
  });
});
