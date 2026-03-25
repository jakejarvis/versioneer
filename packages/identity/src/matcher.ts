import { normalizeBundleId, normalizeName } from "./normalize";
import type { MatchInput, MatchResult, MatchCandidate, AliasRecord } from "./types";

const CONFIDENCE_EXACT_BUNDLE = 100;
const CONFIDENCE_ALIAS_BUNDLE = 95;
const CONFIDENCE_TEAM_NAME = 80;
const CONFIDENCE_ALIAS_NAME = 60;
const AMBIGUITY_THRESHOLD = 15;

/**
 * Match an installed app against known aliases.
 * Aliases should be pre-fetched from D1 and passed in.
 */
export function matchApp(input: MatchInput, aliases: AliasRecord[]): MatchResult {
  const candidates: MatchCandidate[] = [];

  // 1. Exact bundle ID match
  if (input.bundleId) {
    const normalizedBundle = normalizeBundleId(input.bundleId);
    const bundleMatches = aliases.filter(
      (a) => a.aliasType === "bundle_id" && a.normalizedValue === normalizedBundle && a.isExact,
    );
    for (const match of bundleMatches) {
      candidates.push({
        appId: match.appId,
        appName: match.appName,
        method: "exact_bundle_id",
        confidence: CONFIDENCE_EXACT_BUNDLE,
      });
    }
    if (candidates.length > 0) {
      return buildResult(candidates);
    }

    // 2. Alias bundle ID (non-exact)
    const aliasBundleMatches = aliases.filter(
      (a) => a.aliasType === "bundle_id" && a.normalizedValue === normalizedBundle && !a.isExact,
    );
    for (const match of aliasBundleMatches) {
      candidates.push({
        appId: match.appId,
        appName: match.appName,
        method: "alias_bundle_id",
        confidence: Math.min(CONFIDENCE_ALIAS_BUNDLE, match.confidenceWeight),
      });
    }
    if (candidates.length > 0) {
      return buildResult(candidates);
    }
  }

  // 3. Team ID + normalized name
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
            confidence: CONFIDENCE_TEAM_NAME,
          });
        }
      }
    }
    if (candidates.length > 0) {
      return buildResult(candidates);
    }
  }

  // 4. Name alias fallback
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
    if (candidates.length > 0) {
      return buildResult(candidates);
    }
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

function buildResult(candidates: MatchCandidate[]): MatchResult {
  // Deduplicate by appId, keep highest confidence per app
  const byApp = new Map<string, MatchCandidate>();
  for (const c of candidates) {
    const existing = byApp.get(c.appId);
    if (!existing || c.confidence > existing.confidence) {
      byApp.set(c.appId, c);
    }
  }

  const deduped = [...byApp.values()].sort((a, b) => b.confidence - a.confidence);
  const best = deduped[0]!;

  // Check ambiguity: if second-best is close to best
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
