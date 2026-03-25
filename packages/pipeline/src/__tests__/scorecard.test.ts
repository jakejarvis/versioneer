import { describe, it, expect } from "vitest";

import { classifyQualityState, computeQualityScore } from "../scorecard";
import type { ScorecardData } from "../scorecard";

describe("classifyQualityState", () => {
  it("returns green when all metrics are strong", () => {
    const scorecard: ScorecardData = {
      sourceTypesPresent: ["sparkle"],
      latestFetchSuccessAt: "2026-03-25T00:00:00Z",
      recentFetchSuccessRate: 95,
      recentParseSuccessRate: 100,
      latestReleaseConfidence: 90,
      artifactTrustStatus: "valid",
      inventoryMatchSuccessRate: 95,
      ambiguityRate: 2,
      activeOverrideCount: 0,
    };
    expect(classifyQualityState(scorecard)).toBe("green");
  });

  it("returns yellow when metrics are borderline", () => {
    const scorecard: ScorecardData = {
      sourceTypesPresent: ["sparkle"],
      latestFetchSuccessAt: "2026-03-25T00:00:00Z",
      recentFetchSuccessRate: 80,
      recentParseSuccessRate: 85,
      latestReleaseConfidence: 75,
      artifactTrustStatus: "unknown",
      inventoryMatchSuccessRate: 70,
      ambiguityRate: 10,
      activeOverrideCount: 1,
    };
    expect(classifyQualityState(scorecard)).toBe("yellow");
  });

  it("returns red when any critical metric is below threshold", () => {
    const scorecard: ScorecardData = {
      sourceTypesPresent: ["sparkle"],
      latestFetchSuccessAt: null,
      recentFetchSuccessRate: 50,
      recentParseSuccessRate: 90,
      latestReleaseConfidence: 85,
      artifactTrustStatus: "valid",
      inventoryMatchSuccessRate: 90,
      ambiguityRate: 5,
      activeOverrideCount: 0,
    };
    expect(classifyQualityState(scorecard)).toBe("red");
  });

  it("returns unknown when no sources exist", () => {
    const scorecard: ScorecardData = {
      sourceTypesPresent: [],
      latestFetchSuccessAt: null,
      recentFetchSuccessRate: null,
      recentParseSuccessRate: null,
      latestReleaseConfidence: null,
      artifactTrustStatus: null,
      inventoryMatchSuccessRate: null,
      ambiguityRate: null,
      activeOverrideCount: 0,
    };
    expect(classifyQualityState(scorecard)).toBe("unknown");
  });

  it("returns unknown when insufficient data", () => {
    const scorecard: ScorecardData = {
      sourceTypesPresent: ["sparkle"],
      latestFetchSuccessAt: null,
      recentFetchSuccessRate: null,
      recentParseSuccessRate: null,
      latestReleaseConfidence: null,
      artifactTrustStatus: null,
      inventoryMatchSuccessRate: null,
      ambiguityRate: null,
      activeOverrideCount: 0,
    };
    expect(classifyQualityState(scorecard)).toBe("unknown");
  });
});

describe("computeQualityScore", () => {
  it("returns high score for strong metrics", () => {
    const scorecard: ScorecardData = {
      sourceTypesPresent: ["sparkle"],
      latestFetchSuccessAt: "2026-03-25T00:00:00Z",
      recentFetchSuccessRate: 100,
      recentParseSuccessRate: 100,
      latestReleaseConfidence: 100,
      artifactTrustStatus: "valid",
      inventoryMatchSuccessRate: 100,
      ambiguityRate: 0,
      activeOverrideCount: 0,
    };
    expect(computeQualityScore(scorecard)).toBe(100);
  });

  it("returns 0 when no data", () => {
    const scorecard: ScorecardData = {
      sourceTypesPresent: [],
      latestFetchSuccessAt: null,
      recentFetchSuccessRate: null,
      recentParseSuccessRate: null,
      latestReleaseConfidence: null,
      artifactTrustStatus: null,
      inventoryMatchSuccessRate: null,
      ambiguityRate: null,
      activeOverrideCount: 0,
    };
    expect(computeQualityScore(scorecard)).toBe(0);
  });

  it("computes weighted average correctly with partial data", () => {
    const scorecard: ScorecardData = {
      sourceTypesPresent: ["sparkle"],
      latestFetchSuccessAt: "2026-03-25T00:00:00Z",
      recentFetchSuccessRate: 80,
      recentParseSuccessRate: 60,
      latestReleaseConfidence: null,
      artifactTrustStatus: null,
      inventoryMatchSuccessRate: null,
      ambiguityRate: null,
      activeOverrideCount: 0,
    };
    // Only fetch (25) and parse (25) have data
    // (80*25 + 60*25) / 50 = 70
    expect(computeQualityScore(scorecard)).toBe(70);
  });
});
