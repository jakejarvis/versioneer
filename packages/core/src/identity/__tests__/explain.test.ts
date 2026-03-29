import { describe, it, expect } from "vitest";

import { generateMatchExplanation } from "../explain";
import type { AliasRecord, MatchInput, MatchResult } from "../types";

describe("generateMatchExplanation", () => {
  const aliases: AliasRecord[] = [
    {
      appId: "app_1",
      appName: "iTerm2",
      aliasType: "bundle_id",
      value: "com.googlecode.iterm2",
      normalizedValue: "com.googlecode.iterm2",
      isExact: true,
      confidenceWeight: 100,
    },
    {
      appId: "app_2",
      appName: "Terminal",
      aliasType: "name",
      value: "Terminal",
      normalizedValue: "terminal",
      isExact: false,
      confidenceWeight: 60,
    },
  ];

  it("explains exact bundle ID match", () => {
    const input: MatchInput = { appName: "iTerm", bundleId: "com.googlecode.iterm2" };
    const result: MatchResult = {
      matched: true,
      appId: "app_1",
      appName: "iTerm2",
      method: "exact_bundle_id",
      confidence: 100,
      candidates: [
        { appId: "app_1", appName: "iTerm2", method: "exact_bundle_id", confidence: 100 },
      ],
      ambiguous: false,
    };

    const explanation = generateMatchExplanation(input, result, aliases);

    expect(explanation.method).toBe("exact_bundle_id");
    expect(explanation.confidence).toBe(100);
    expect(explanation.matchedAliasType).toBe("bundle_id");
    expect(explanation.matchedAliasValue).toBe("com.googlecode.iterm2");
    expect(explanation.candidateCount).toBe(1);
    expect(explanation.ambiguous).toBe(false);
    expect(explanation.ambiguityGap).toBeNull();
  });

  it("explains ambiguous match with gap", () => {
    const input: MatchInput = { appName: "Terminal" };
    const result: MatchResult = {
      matched: true,
      appId: "app_1",
      appName: "iTerm2",
      method: "alias_name",
      confidence: 60,
      candidates: [
        { appId: "app_1", appName: "iTerm2", method: "alias_name", confidence: 60 },
        { appId: "app_2", appName: "Terminal", method: "alias_name", confidence: 55 },
      ],
      ambiguous: true,
    };

    const explanation = generateMatchExplanation(input, result, aliases);

    expect(explanation.ambiguous).toBe(true);
    expect(explanation.ambiguityGap).toBe(5);
    expect(explanation.candidateCount).toBe(2);
    expect(explanation.topCandidates).toHaveLength(2);
  });

  it("explains no match", () => {
    const input: MatchInput = { appName: "Unknown App" };
    const result: MatchResult = {
      matched: false,
      appId: null,
      appName: null,
      method: "none",
      confidence: 0,
      candidates: [],
      ambiguous: false,
    };

    const explanation = generateMatchExplanation(input, result, aliases);

    expect(explanation.method).toBe("none");
    expect(explanation.confidence).toBe(0);
    expect(explanation.matchedAliasType).toBeNull();
    expect(explanation.matchedAliasValue).toBeNull();
    expect(explanation.candidateCount).toBe(0);
  });
});
