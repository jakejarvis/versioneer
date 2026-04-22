import { describe, expect, it } from "vite-plus/test";

import {
  artifactSupportsTarget,
  artifactCompatibilityIsKnown,
  architectureFromText,
  mergeArtifactArchitectures,
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

  it("infers universal architecture from mixed architecture text", () => {
    expect(architectureFromText("MyApp-arm64-x64.dmg")).toBe("universal");
    expect(architectureFromText("MyApp-apple-silicon-intel.zip")).toBe("universal");
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

  it("separates possible compatibility from known compatibility", () => {
    expect(artifactCompatibilityIsKnown("universal", null)).toBe(true);
    expect(artifactCompatibilityIsKnown("unknown", "arm64")).toBe(false);
    expect(artifactCompatibilityIsKnown("x86_64", "arm64")).toBe(true);
    expect(artifactCompatibilityIsKnown("arm64", null)).toBe(false);
  });

  it("merges duplicate artifact architecture observations conservatively", () => {
    expect(mergeArtifactArchitectures("arm64", undefined)).toBe("arm64");
    expect(mergeArtifactArchitectures("unknown", "x86_64")).toBe("x86_64");
    expect(mergeArtifactArchitectures("arm64", "x86_64")).toBe("universal");
    expect(mergeArtifactArchitectures("universal", "arm64")).toBe("universal");
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
