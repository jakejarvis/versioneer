import { normalizeBundleId, normalizeName } from "./normalize";
import type { MatchInput, MatchResult, MatchCandidate, AliasRecord } from "./types";

const CONFIDENCE_EXACT_BUNDLE = 100;
const CONFIDENCE_ALIAS_BUNDLE = 95;
const CONFIDENCE_SPARKLE_FEED = 90;
const CONFIDENCE_HOMEBREW_CASK = 88;
const CONFIDENCE_TEAM_NAME = 80;
const CONFIDENCE_ALIAS_NAME = 60;
const MULTI_SIGNAL_BONUS = 8;
const AMBIGUITY_THRESHOLD = 10;

function normalizeAliasValue(value: string): string {
  return value.toLowerCase().trim();
}

/**
 * Match an installed app against known aliases.
 * Aliases should be pre-fetched from D1 and passed in.
 */
export function matchApp(input: MatchInput, aliases: AliasRecord[]): MatchResult {
  const candidates: MatchCandidate[] = [];

  if (input.bundleId) {
    const normalizedBundle = normalizeBundleId(input.bundleId);
    pushAliasMatches(
      candidates,
      aliases,
      "bundle_id",
      normalizedBundle,
      "exact_bundle_id",
      CONFIDENCE_EXACT_BUNDLE,
      true,
    );
    pushAliasMatches(
      candidates,
      aliases,
      "bundle_id",
      normalizedBundle,
      "alias_bundle_id",
      CONFIDENCE_ALIAS_BUNDLE,
      false,
    );
  }

  if (input.sparkleFeedUrl) {
    pushAliasMatches(
      candidates,
      aliases,
      "sparkle_feed",
      normalizeAliasValue(input.sparkleFeedUrl),
      "sparkle_feed",
      CONFIDENCE_SPARKLE_FEED,
    );
  }

  if (input.homebrewCaskToken) {
    pushAliasMatches(
      candidates,
      aliases,
      "homebrew_cask",
      normalizeAliasValue(input.homebrewCaskToken),
      "homebrew_cask",
      CONFIDENCE_HOMEBREW_CASK,
    );
  }

  if (input.teamId && input.appName) {
    const normalizedInputName = normalizeName(input.appName);
    const teamMatches = aliases.filter(
      (a) => a.aliasType === "team_id" && a.normalizedValue === input.teamId!.toLowerCase(),
    );
    const teamAppIds = new Set(teamMatches.map((a) => a.appId));

    for (const appId of teamAppIds) {
      const nameAliases = aliases.filter((a) => a.appId === appId && a.aliasType === "name");
      for (const nameAlias of nameAliases) {
        if (nameAlias.normalizedValue === normalizedInputName) {
          candidates.push({
            appId: nameAlias.appId,
            appName: nameAlias.appName,
            method: "team_id_name",
            confidence: Math.min(CONFIDENCE_TEAM_NAME, nameAlias.confidenceWeight),
          });
        }
      }
    }
  }

  if (input.appName) {
    const normalizedInputName = normalizeName(input.appName);
    const nameMatches = aliases.filter(
      (a) => a.aliasType === "name" && a.normalizedValue === normalizedInputName,
    );
    for (const match of nameMatches) {
      candidates.push({
        appId: match.appId,
        appName: match.appName,
        method: "alias_name",
        confidence: Math.min(CONFIDENCE_ALIAS_NAME, match.confidenceWeight),
      });
    }
  }

  if (candidates.length > 0) {
    return buildResult(candidates);
  }

  return {
    matched: false,
    appId: null,
    appName: null,
    method: "none",
    confidence: 0,
    candidates: [],
    ambiguous: false,
  };
}

function pushAliasMatches(
  candidates: MatchCandidate[],
  aliases: AliasRecord[],
  aliasType: string,
  normalizedValue: string,
  method: MatchCandidate["method"],
  defaultConfidence: number,
  isExact?: boolean,
): void {
  const matches = aliases.filter(
    (a) =>
      a.aliasType === aliasType &&
      a.normalizedValue === normalizedValue &&
      (isExact === undefined || a.isExact === isExact),
  );

  for (const match of matches) {
    candidates.push({
      appId: match.appId,
      appName: match.appName,
      method,
      confidence: Math.min(defaultConfidence, match.confidenceWeight),
    });
  }
}

function buildResult(candidates: MatchCandidate[]): MatchResult {
  const byApp = new Map<string, { best: MatchCandidate; score: number; methods: Set<string> }>();
  for (const c of candidates) {
    const existing = byApp.get(c.appId);
    if (!existing) {
      byApp.set(c.appId, {
        best: c,
        score: c.confidence,
        methods: new Set([c.method]),
      });
      continue;
    }

    existing.score += c.confidence;
    existing.methods.add(c.method);
    if (c.confidence > existing.best.confidence) {
      existing.best = c;
    }
  }

  const deduped = [...byApp.values()]
    .map(({ best, score, methods }) => {
      const confidence = Math.min(100, score + Math.max(0, methods.size - 1) * MULTI_SIGNAL_BONUS);
      return {
        appId: best.appId,
        appName: best.appName,
        method: best.method,
        confidence,
      };
    })
    .sort((a, b) => b.confidence - a.confidence);
  const best = deduped[0]!;

  const ambiguous =
    deduped.length > 1 && best.confidence - deduped[1]!.confidence < AMBIGUITY_THRESHOLD;

  return {
    matched: true,
    appId: best.appId,
    appName: best.appName,
    method: best.method,
    confidence: best.confidence,
    candidates: deduped,
    ambiguous,
  };
}
