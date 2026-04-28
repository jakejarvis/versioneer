export type { AliasType } from "@versioneer/schemas/catalog";
export { normalizeAliasValue, isGloballyUniqueExactAliasType } from "./aliases";
export type {
  MatchInput,
  MatchResult,
  MatchCandidate,
  MatchMethod,
  MatchExplanation,
  AliasRecord,
  TrustAssertionRecord,
} from "./types";
export { createAliasMatchIndex, matchApp, matchAppWithIndex } from "./matcher";
export type { AliasMatchIndex } from "./matcher";
export { normalizeName, normalizeBundleId } from "./normalize";
export { generateMatchExplanation } from "./explain";
