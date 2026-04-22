import { describe, it, expect } from "vite-plus/test";

import { displayVersion } from "../normalize";

describe("displayVersion", () => {
  it("returns simple semver as-is", () => {
    expect(displayVersion("1.2.3")).toBe("1.2.3");
  });

  it("strips leading v", () => {
    expect(displayVersion("v1.2.3")).toBe("1.2.3");
  });

  it("strips leading V", () => {
    expect(displayVersion("V1.2.3")).toBe("1.2.3");
  });

  it("strips name prefix like release-3.5.7", () => {
    expect(displayVersion("release-3.5.7")).toBe("3.5.7");
  });

  it("strips name prefix like XQuartz-2.8.6_beta4", () => {
    expect(displayVersion("XQuartz-2.8.6_beta4")).toBe("2.8.6_beta4");
  });

  it("preserves pre-release prefix like beta-1.0", () => {
    expect(displayVersion("beta-1.0")).toBe("beta-1.0");
  });

  it("preserves pre-release prefix like alpha-2.0", () => {
    expect(displayVersion("alpha-2.0")).toBe("alpha-2.0");
  });

  it("preserves pre-release prefix like rc-3.0", () => {
    expect(displayVersion("rc-3.0")).toBe("rc-3.0");
  });

  it("trims whitespace", () => {
    expect(displayVersion("  1.2.3  ")).toBe("1.2.3");
  });

  it("handles v prefix with name prefix", () => {
    // "v" stripped first, then "release-" is not present — just a version
    expect(displayVersion("v3.5.7")).toBe("3.5.7");
  });
});
