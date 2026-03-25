export type { MatchInput, MatchResult, MatchCandidate, MatchMethod, AliasRecord } from "./types";
export { matchApp } from "./matcher";
export { normalizeName, normalizeBundleId } from "./normalize";
export { generateMatchExplanation } from "./explain";
