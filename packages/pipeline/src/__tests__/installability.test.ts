import { describe, it, expect } from "vitest";

import { classifyInstallability } from "../installability";

describe("classifyInstallability", () => {
  it("returns notify_only when no install rule", () => {
    expect(
      classifyInstallability({
        verificationTier: "verified",
        installRule: null,
        hasArtifact: true,
      }),
    ).toBe("notify_only");
  });

  it("returns notify_only when unverified", () => {
    expect(
      classifyInstallability({
        verificationTier: "unverified",
        installRule: { strategy: "sparkle", enabled: true },
        hasArtifact: true,
      }),
    ).toBe("notify_only");
  });

  it("returns automation_candidate for verified sparkle installs", () => {
    expect(
      classifyInstallability({
        verificationTier: "verified",
        installRule: { strategy: "sparkle", enabled: true },
        hasArtifact: false,
      }),
    ).toBe("automation_candidate");
  });

  it("returns assisted_replace for verified archive installs", () => {
    expect(
      classifyInstallability({
        verificationTier: "verified",
        installRule: { strategy: "zip_replace", enabled: true },
        hasArtifact: true,
      }),
    ).toBe("assisted_replace");
  });

  it("returns assisted_download for provisional archive installs", () => {
    expect(
      classifyInstallability({
        verificationTier: "provisional",
        installRule: { strategy: "dmg_copy_replace", enabled: true },
        hasArtifact: true,
      }),
    ).toBe("assisted_download");
  });

  it("returns notify_only when a non-sparkle strategy has no artifact", () => {
    expect(
      classifyInstallability({
        verificationTier: "provisional",
        installRule: { strategy: "zip_replace", enabled: true },
        hasArtifact: false,
      }),
    ).toBe("notify_only");
  });

  it("returns notify_only when rule is disabled", () => {
    expect(
      classifyInstallability({
        verificationTier: "verified",
        installRule: { strategy: "sparkle", enabled: false },
        hasArtifact: true,
      }),
    ).toBe("notify_only");
  });

  it("returns notify_only for pkg_manual strategies", () => {
    expect(
      classifyInstallability({
        verificationTier: "verified",
        installRule: { strategy: "pkg_manual", enabled: true },
        hasArtifact: true,
      }),
    ).toBe("notify_only");
  });
});
