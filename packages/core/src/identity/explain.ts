import type { AliasRecord, MatchExplanation, MatchInput, MatchResult } from "./types";

export function generateMatchExplanation(
  input: MatchInput,
  result: MatchResult,
  aliases: AliasRecord[],
): MatchExplanation {
  let matchedAliasType: string | null = null;
  let matchedAliasValue: string | null = null;

  if (result.matched && result.appId) {
    // Find the alias that contributed to the winning match
    const winningCandidate = result.candidates[0];
    if (winningCandidate) {
      const matchingAlias = findMatchingAlias(
        input,
        winningCandidate.method,
        result.appId,
        aliases,
      );
      if (matchingAlias) {
        matchedAliasType = matchingAlias.aliasType;
        matchedAliasValue = matchingAlias.value;
      }
    }
  }

  const secondBest = result.candidates[1];
  const ambiguityGap =
    result.ambiguous && secondBest ? result.confidence - secondBest.confidence : null;

  return {
    method: result.method,
    confidence: result.confidence,
    matchedAliasType,
    matchedAliasValue,
    candidateCount: result.candidates.length,
    ambiguous: result.ambiguous,
    ambiguityGap,
    topCandidates: result.candidates.slice(0, 5).map((c) => ({
      appId: c.appId,
      appName: c.appName,
      method: c.method,
      confidence: c.confidence,
    })),
  };
}

function findMatchingAlias(
  input: MatchInput,
  method: string,
  appId: string,
  aliases: AliasRecord[],
): AliasRecord | undefined {
  switch (method) {
    case "exact_bundle_id":
    case "alias_bundle_id":
      return aliases.find(
        (a) =>
          a.appId === appId &&
          a.aliasType === "bundle_id" &&
          a.normalizedValue === input.bundleId?.toLowerCase().trim(),
      );
    case "sparkle_feed":
      return aliases.find(
        (a) =>
          a.appId === appId &&
          a.aliasType === "sparkle_feed" &&
          a.normalizedValue === input.sparkleFeedUrl?.toLowerCase().trim(),
      );
    case "mas_app_id":
      return aliases.find(
        (a) =>
          a.appId === appId &&
          a.aliasType === "mas_app_id" &&
          a.normalizedValue === input.masAppId?.toLowerCase().trim(),
      );
    case "electron_update_url":
      return aliases.find(
        (a) =>
          a.appId === appId &&
          a.aliasType === "electron_update_url" &&
          a.normalizedValue === input.electronUpdateUrl?.toLowerCase().trim(),
      );
    case "homebrew_cask":
      return aliases.find(
        (a) =>
          a.appId === appId &&
          a.aliasType === "homebrew_cask" &&
          a.normalizedValue === input.homebrewCaskToken?.toLowerCase().trim(),
      );
    case "team_id_name":
      return aliases.find(
        (a) => a.appId === appId && (a.aliasType === "team_id" || a.aliasType === "name"),
      );
    case "alias_name":
      return aliases.find((a) => a.appId === appId && a.aliasType === "name");
    default:
      return undefined;
  }
}
