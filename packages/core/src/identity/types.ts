export interface MatchCandidate {
  appId: string;
  appName: string;
  method: MatchMethod;
  confidence: number;
}

export type MatchMethod =
  | "exact_bundle_id"
  | "alias_bundle_id"
  | "sparkle_feed"
  | "mas_app_id"
  | "electron_update_url"
  | "homebrew_cask"
  | "team_id_name"
  | "alias_name"
  | "match_rule"
  | "none";

export interface MatchResult {
  matched: boolean;
  appId: string | null;
  appName: string | null;
  method: MatchMethod;
  confidence: number;
  candidates: MatchCandidate[];
  ambiguous: boolean;
}

export interface MatchInput {
  appName: string;
  bundleId?: string | null;
  teamId?: string | null;
  version?: string | null;
  sparkleFeedUrl?: string | null;
  sparklePublicKey?: string | null;
  masAppId?: string | null;
  electronUpdateUrl?: string | null;
  homebrewCaskToken?: string | null;
}

export interface AliasRecord {
  appId: string;
  appName: string;
  aliasType: string;
  value: string;
  normalizedValue: string;
  isExact: boolean;
  confidenceWeight: number;
}

export interface TrustAssertionRecord {
  appId: string;
  assertionType: string;
  value: string;
}

export interface MatchExplanation {
  method: string;
  confidence: number;
  matchedAliasType: string | null;
  matchedAliasValue: string | null;
  candidateCount: number;
  ambiguous: boolean;
  ambiguityGap: number | null;
  topCandidates: { appId: string; appName: string; method: string; confidence: number }[];
}
