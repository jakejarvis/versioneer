import { normalizeAliasValue } from "./aliases";
import { normalizeBundleId, normalizeName } from "./normalize";
import type {
  MatchInput,
  MatchResult,
  MatchCandidate,
  AliasRecord,
  TrustAssertionRecord,
} from "./types";

const CONFIDENCE_EXACT_BUNDLE = 100;
const CONFIDENCE_ALIAS_BUNDLE = 95;
const CONFIDENCE_MAS_APP_ID = 90;
const CONFIDENCE_SPARKLE_FEED = 90;
const CONFIDENCE_ELECTRON_UPDATE_URL = 89;
const CONFIDENCE_HOMEBREW_CASK = 88;
const CONFIDENCE_TEAM_NAME = 80;
const CONFIDENCE_ALIAS_NAME = 60;
const CONFIDENCE_SPARKLE_PUBLIC_KEY_BONUS = 12;
const MULTI_SIGNAL_BONUS = 8;
const AMBIGUITY_THRESHOLD = 10;

export type AliasMatchIndex = {
  readonly aliasesByTypeValue: ReadonlyMap<string, readonly AliasRecord[]>;
  readonly exactAliasesByTypeValue: ReadonlyMap<string, readonly AliasRecord[]>;
  readonly inexactAliasesByTypeValue: ReadonlyMap<string, readonly AliasRecord[]>;
  readonly nameAliasesByAppId: ReadonlyMap<string, readonly AliasRecord[]>;
  readonly teamAppIdsByValue: ReadonlyMap<string, ReadonlySet<string>>;
  readonly sparkleAppIdsByKey: ReadonlyMap<string, ReadonlySet<string>>;
};

type MutableAliasMatchIndex = {
  aliasesByTypeValue: Map<string, AliasRecord[]>;
  exactAliasesByTypeValue: Map<string, AliasRecord[]>;
  inexactAliasesByTypeValue: Map<string, AliasRecord[]>;
  nameAliasesByAppId: Map<string, AliasRecord[]>;
  teamAppIdsByValue: Map<string, Set<string>>;
  sparkleAppIdsByKey: Map<string, Set<string>>;
};

/**
 * Match an installed app against known aliases.
 * Aliases should be pre-fetched from D1 and passed in.
 */
export function matchApp(
  input: MatchInput,
  aliases: AliasRecord[],
  trustAssertions: TrustAssertionRecord[] = [],
): MatchResult {
  return matchAppWithIndex(input, createAliasMatchIndex(aliases, trustAssertions));
}

export function createAliasMatchIndex(
  aliases: AliasRecord[],
  trustAssertions: TrustAssertionRecord[] = [],
): AliasMatchIndex {
  const index: MutableAliasMatchIndex = {
    aliasesByTypeValue: new Map(),
    exactAliasesByTypeValue: new Map(),
    inexactAliasesByTypeValue: new Map(),
    nameAliasesByAppId: new Map(),
    teamAppIdsByValue: new Map(),
    sparkleAppIdsByKey: new Map(),
  };

  for (const alias of aliases) {
    pushMapArray(
      index.aliasesByTypeValue,
      aliasLookupKey(alias.aliasType, alias.normalizedValue),
      alias,
    );
    if (alias.aliasType === "name") {
      pushMapArray(index.nameAliasesByAppId, alias.appId, alias);
    }

    if (alias.isExact) {
      pushMapArray(
        index.exactAliasesByTypeValue,
        aliasLookupKey(alias.aliasType, alias.normalizedValue),
        alias,
      );
    } else {
      pushMapArray(
        index.inexactAliasesByTypeValue,
        aliasLookupKey(alias.aliasType, alias.normalizedValue),
        alias,
      );
    }

    if (alias.aliasType === "team_id") {
      pushMapSet(index.teamAppIdsByValue, alias.normalizedValue, alias.appId);
    }
  }

  for (const assertion of trustAssertions) {
    if (assertion.assertionType !== "sparkle_public_key") continue;
    const normalizedKey = normalizeSparklePublicKey(assertion.value);
    if (!normalizedKey) continue;
    pushMapSet(index.sparkleAppIdsByKey, normalizedKey, assertion.appId);
  }

  return index;
}

export function matchAppWithIndex(input: MatchInput, index: AliasMatchIndex): MatchResult {
  const candidates: MatchCandidate[] = [];

  if (input.bundleId) {
    const normalizedBundle = normalizeBundleId(input.bundleId);
    pushAliasMatches(
      candidates,
      index,
      "bundle_id",
      normalizedBundle,
      "exact_bundle_id",
      CONFIDENCE_EXACT_BUNDLE,
      true,
    );
    pushAliasMatches(
      candidates,
      index,
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
      index,
      "sparkle_feed",
      normalizeAliasValue("sparkle_feed", input.sparkleFeedUrl),
      "sparkle_feed",
      CONFIDENCE_SPARKLE_FEED,
    );
  }

  if (input.masAppId) {
    pushAliasMatches(
      candidates,
      index,
      "mas_app_id",
      normalizeAliasValue("mas_app_id", input.masAppId),
      "mas_app_id",
      CONFIDENCE_MAS_APP_ID,
    );
  }

  if (input.electronUpdateUrl) {
    pushAliasMatches(
      candidates,
      index,
      "electron_update_url",
      normalizeAliasValue("electron_update_url", input.electronUpdateUrl),
      "electron_update_url",
      CONFIDENCE_ELECTRON_UPDATE_URL,
    );
  }

  if (input.homebrewCaskToken) {
    pushAliasMatches(
      candidates,
      index,
      "homebrew_cask",
      normalizeAliasValue("homebrew_cask", input.homebrewCaskToken),
      "homebrew_cask",
      CONFIDENCE_HOMEBREW_CASK,
    );
  }

  if (input.teamId && input.appName) {
    const normalizedInputName = normalizeName(input.appName);
    const teamAppIds = index.teamAppIdsByValue.get(input.teamId.toLowerCase()) ?? new Set();

    for (const appId of teamAppIds) {
      const nameAliases = index.nameAliasesByAppId.get(appId) ?? [];
      for (const nameAlias of nameAliases) {
        if (nameAlias.aliasType === "name" && nameAlias.normalizedValue === normalizedInputName) {
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
    const nameMatches =
      index.aliasesByTypeValue.get(aliasLookupKey("name", normalizedInputName)) ?? [];
    for (const match of nameMatches) {
      candidates.push({
        appId: match.appId,
        appName: match.appName,
        method: "alias_name",
        confidence: Math.min(CONFIDENCE_ALIAS_NAME, match.confidenceWeight),
      });
    }
  }

  applySparklePublicKeyBonuses(candidates, input, index);

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

function applySparklePublicKeyBonuses(
  candidates: MatchCandidate[],
  input: MatchInput,
  index: AliasMatchIndex,
): void {
  if (!input.sparklePublicKey || candidates.length === 0) {
    return;
  }

  const normalizedKey = normalizeSparklePublicKey(input.sparklePublicKey);
  if (!normalizedKey) {
    return;
  }

  const matchingAppIds = index.sparkleAppIdsByKey.get(normalizedKey);
  if (!matchingAppIds || matchingAppIds.size === 0) {
    return;
  }

  const strongestCandidates = new Map<string, MatchCandidate>();
  for (const candidate of candidates) {
    if (!matchingAppIds.has(candidate.appId)) {
      continue;
    }

    const existing = strongestCandidates.get(candidate.appId);
    if (!existing || candidate.confidence > existing.confidence) {
      strongestCandidates.set(candidate.appId, candidate);
    }
  }

  for (const candidate of strongestCandidates.values()) {
    candidates.push({
      ...candidate,
      confidence: CONFIDENCE_SPARKLE_PUBLIC_KEY_BONUS,
    });
  }
}

function normalizeSparklePublicKey(value: string): string {
  return value.replace(/\s+/g, "").trim();
}

function pushAliasMatches(
  candidates: MatchCandidate[],
  index: AliasMatchIndex,
  aliasType: string,
  normalizedValue: string,
  method: MatchCandidate["method"],
  defaultConfidence: number,
  isExact?: boolean,
): void {
  const key = aliasLookupKey(aliasType, normalizedValue);
  const matches =
    isExact === true
      ? (index.exactAliasesByTypeValue.get(key) ?? [])
      : isExact === false
        ? (index.inexactAliasesByTypeValue.get(key) ?? [])
        : (index.aliasesByTypeValue.get(key) ?? []);

  for (const match of matches) {
    candidates.push({
      appId: match.appId,
      appName: match.appName,
      method,
      confidence: Math.min(defaultConfidence, match.confidenceWeight),
    });
  }
}

function aliasLookupKey(aliasType: string, normalizedValue: string): string {
  return `${aliasType}\0${normalizedValue}`;
}

function pushMapArray<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
    return;
  }
  map.set(key, [value]);
}

function pushMapSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.add(value);
    return;
  }
  map.set(key, new Set([value]));
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
