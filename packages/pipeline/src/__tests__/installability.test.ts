import { describe, it, expect } from "vitest";

import { classifyInstallability } from "../installability";

describe("classifyInstallability", () => {
  it("returns notify_only when no install rule", () => {
    expect(
      classifyInstallability({
        verificationTier: "verified",
        installRule: null,
        artifactTrustLevel: "high",
        sourceQuality: 95,
      }),
    ).toBe("notify_only");
  });

  it("returns notify_only when unverified", () => {
    expect(
      classifyInstallability({
        verificationTier: "unverified",
        installRule: { strategy: "sparkle", enabled: true },
        artifactTrustLevel: "high",
        sourceQuality: 95,
      }),
    ).toBe("notify_only");
  });

  it("returns automation_candidate for verified + high trust + sparkle", () => {
    expect(
      classifyInstallability({
        verificationTier: "verified",
        installRule: { strategy: "sparkle", enabled: true },
        artifactTrustLevel: "high",
        sourceQuality: 95,
      }),
    ).toBe("automation_candidate");
  });

  it("returns assisted_replace for verified + medium trust", () => {
    expect(
      classifyInstallability({
        verificationTier: "verified",
        installRule: { strategy: "zip_replace", enabled: true },
        artifactTrustLevel: "medium",
        sourceQuality: 85,
      }),
    ).toBe("assisted_replace");
  });

  it("returns assisted_download for provisional + medium trust", () => {
    expect(
      classifyInstallability({
        verificationTier: "provisional",
        installRule: { strategy: "dmg_copy_replace", enabled: true },
        artifactTrustLevel: "medium",
        sourceQuality: 80,
      }),
    ).toBe("assisted_download");
  });

  it("returns notify_only for provisional + low trust", () => {
    expect(
      classifyInstallability({
        verificationTier: "provisional",
        installRule: { strategy: "sparkle", enabled: true },
        artifactTrustLevel: "low",
        sourceQuality: 70,
      }),
    ).toBe("notify_only");
  });

  it("returns notify_only when rule is disabled", () => {
    expect(
      classifyInstallability({
        verificationTier: "verified",
        installRule: { strategy: "sparkle", enabled: false },
        artifactTrustLevel: "high",
        sourceQuality: 95,
      }),
    ).toBe("notify_only");
  });
});
