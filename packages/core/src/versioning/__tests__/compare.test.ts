import { describe, it, expect } from "vite-plus/test";

import { compareVersionStrings, isNewer, sortVersions, latestVersion } from "../compare";
import { normalizeVersion } from "../normalize";

describe("compareVersionStrings", () => {
  it("1.0.0 < 1.0.1", () => {
    expect(compareVersionStrings("1.0.0", "1.0.1")).toBe(-1);
  });

  it("2.0.0 > 1.9.9", () => {
    expect(compareVersionStrings("2.0.0", "1.9.9")).toBe(1);
  });

  it("1.0.0 == 1.0.0", () => {
    expect(compareVersionStrings("1.0.0", "1.0.0")).toBe(0);
  });

  it("pre-release is older than release", () => {
    expect(compareVersionStrings("1.0.0-beta1", "1.0.0")).toBe(-1);
  });

  it("beta > alpha", () => {
    expect(compareVersionStrings("1.0.0-beta1", "1.0.0-alpha1")).toBe(1);
  });

  it("rc > beta", () => {
    expect(compareVersionStrings("1.0.0-rc1", "1.0.0-beta1")).toBe(1);
  });
});

describe("isNewer", () => {
  it("detects newer version", () => {
    expect(isNewer("2.0", "1.0")).toBe(true);
    expect(isNewer("1.0", "2.0")).toBe(false);
  });
});

describe("sortVersions", () => {
  it("sorts versions correctly", () => {
    const sorted = sortVersions(["3.0", "1.0", "2.0", "1.0-beta1"]);
    expect(sorted).toEqual(["1.0-beta1", "1.0", "2.0", "3.0"]);
  });
});

describe("latestVersion", () => {
  it("finds the latest", () => {
    expect(latestVersion(["1.0", "3.0", "2.0"])).toBe("3.0");
  });

  it("returns null for empty array", () => {
    expect(latestVersion([])).toBeNull();
  });
});

describe("normalized string comparison", () => {
  it("normalized release sorts after pre-release via direct comparison", () => {
    const release = normalizeVersion("1.0.0");
    const beta = normalizeVersion("1.0.0-beta1");
    // Normalized strings are designed for direct lexicographic comparison.
    // Do NOT re-parse them via compareVersionStrings — that would mangle
    // the internal "-0.001.…" pre-release suffix format.
    expect(release > beta).toBe(true);
  });

  it("normalized pre-release ordering preserved via direct comparison", () => {
    const alpha = normalizeVersion("1.0.0-alpha1");
    const beta = normalizeVersion("1.0.0-beta1");
    const rc = normalizeVersion("1.0.0-rc1");
    expect(alpha < beta).toBe(true);
    expect(beta < rc).toBe(true);
  });
});
