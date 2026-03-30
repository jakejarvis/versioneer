import { describe, it, expect } from "vitest";

import { parseVersion } from "../parse";

describe("parseVersion", () => {
  it("parses simple semver", () => {
    const v = parseVersion("1.2.3");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(3);
    expect(v.preReleaseTag).toBeNull();
  });

  it("parses two-segment version", () => {
    const v = parseVersion("1.2");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(0);
  });

  it("parses date-like version", () => {
    const v = parseVersion("2024.9");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(2024);
    expect(v.minor).toBe(9);
  });

  it("parses version with leading v", () => {
    const v = parseVersion("v3.1.4");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(3);
    expect(v.minor).toBe(1);
    expect(v.patch).toBe(4);
  });

  it("parses inline pre-release like 5.0b3", () => {
    const v = parseVersion("5.0b3");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(5);
    expect(v.minor).toBe(0);
    expect(v.preReleaseTag).toBe("b");
    expect(v.preReleaseNumber).toBe(3);
  });

  it("parses dash pre-release like 1.0-rc1", () => {
    const v = parseVersion("1.0-rc1");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(1);
    expect(v.minor).toBe(0);
    expect(v.preReleaseTag).toBe("rc");
    expect(v.preReleaseNumber).toBe(1);
  });

  it("parses version with build metadata", () => {
    const v = parseVersion("1.0.0+build123");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(1);
    expect(v.buildMetadata).toBe("build123");
  });

  it("parses four-segment version", () => {
    const v = parseVersion("1.2.3.4");
    expect(v.valid).toBe(true);
    expect(v.extra).toEqual([4]);
  });

  it("returns invalid for empty string", () => {
    const v = parseVersion("");
    expect(v.valid).toBe(false);
  });

  it("parses alpha pre-release", () => {
    const v = parseVersion("2.0-alpha.1");
    expect(v.valid).toBe(true);
    expect(v.preReleaseTag).toBe("alpha");
    expect(v.preReleaseNumber).toBe(1);
  });

  it("parses single-segment version", () => {
    const v = parseVersion("5");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(5);
    expect(v.minor).toBe(0);
    expect(v.patch).toBe(0);
  });

  it("parses zero as valid version", () => {
    const v = parseVersion("0");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(0);
  });

  it("rejects trailing dot", () => {
    const v = parseVersion("1.2.3.");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(1);
    expect(v.minor).toBe(2);
    expect(v.patch).toBe(3);
    expect(v.extra).toEqual([]);
  });

  it("rejects consecutive dots", () => {
    const v = parseVersion("1..2");
    expect(v.valid).toBe(false);
  });

  it("clamps negative segments to zero", () => {
    const v = parseVersion("-1.0.0");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(0);
  });

  it("clamps segments exceeding 10-digit limit", () => {
    const v = parseVersion("99999999999.0.0");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(9999999999);
  });

  it("strips name prefix like release-3.5.7-beta3", () => {
    const v = parseVersion("release-3.5.7-beta3");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(3);
    expect(v.minor).toBe(5);
    expect(v.patch).toBe(7);
    expect(v.preReleaseTag).toBe("beta");
    expect(v.preReleaseNumber).toBe(3);
  });

  it("strips name prefix like XQuartz-2.8.6_beta4", () => {
    const v = parseVersion("XQuartz-2.8.6_beta4");
    expect(v.valid).toBe(true);
    expect(v.major).toBe(2);
    expect(v.minor).toBe(8);
    expect(v.patch).toBe(6);
    expect(v.preReleaseTag).toBe("beta");
    expect(v.preReleaseNumber).toBe(4);
  });

  it("does not strip pre-release tag prefix like beta-1.0", () => {
    // "beta" is a known pre-release tag, not a name prefix
    const v = parseVersion("beta-1.0");
    expect(v.major).toBe(0);
  });
});
