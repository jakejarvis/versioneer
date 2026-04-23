import { z } from "zod";

export const queueTypeValues = [
  "new_app",
  "new_source",
  "metadata_change",
  "authority_handoff",
  "merge_proposal",
  "release_discrepancy",
] as const;
export const queueTypeSchema = z.enum(queueTypeValues);
export type QueueType = z.infer<typeof queueTypeSchema>;

export const suggestionStatusValues = [
  "pending",
  "processing",
  "failed",
  "approved",
  "rejected",
  "superseded",
] as const;
export const suggestionStatusSchema = z.enum(suggestionStatusValues);
export type SuggestionStatus = z.infer<typeof suggestionStatusSchema>;

export const evidenceTypeValues = [
  "scan",
  "crawl",
  "fetch_parse",
  "install_verify",
  "homebrew",
  "manual",
] as const;
export const evidenceTypeSchema = z.enum(evidenceTypeValues);
export type EvidenceType = z.infer<typeof evidenceTypeSchema>;

export const assertionTypeValues = [
  "sparkle_public_key",
  "bundle_id",
  "team_id",
  "notarization_expectation",
  "signature_requirement",
] as const;
export const assertionTypeSchema = z.enum(assertionTypeValues);
export type AssertionType = z.infer<typeof assertionTypeSchema>;
