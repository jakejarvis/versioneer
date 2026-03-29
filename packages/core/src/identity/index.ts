export type { AppAliasType } from "./aliases";
export { normalizeAliasValue, isGloballyUniqueExactAliasType } from "./aliases";
export type {
  MatchInput,
  MatchResult,
  MatchCandidate,
  MatchMethod,
  MatchExplanation,
  AliasRecord,
} from "./types";
export { matchApp } from "./matcher";
export { normalizeName, normalizeBundleId } from "./normalize";
export { generateMatchExplanation } from "./explain";
