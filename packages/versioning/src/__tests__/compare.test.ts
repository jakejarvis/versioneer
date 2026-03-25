import { describe, it, expect } from "vitest";
import { compareVersionStrings, isNewer, sortVersions, latestVersion } from "../compare";

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
