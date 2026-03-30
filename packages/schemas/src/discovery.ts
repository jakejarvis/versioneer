import { z } from "zod";

export const discoveredAppStatusValues = [
  "pending",
  "linked",
  "dismissed",
  "support_only",
] as const;
export const discoveredAppStatusSchema = z.enum(discoveredAppStatusValues);
export type DiscoveredAppStatus = z.infer<typeof discoveredAppStatusSchema>;

export const enrichmentStatusValues = [
  "pending",
  "in_progress",
  "success",
  "failed",
  "skipped",
] as const;
export const enrichmentStatusSchema = z.enum(enrichmentStatusValues);
export type EnrichmentStatus = z.infer<typeof enrichmentStatusSchema>;

export const sourceValidationStatusValues = ["untested", "valid", "invalid", "timeout"] as const;
export const sourceValidationStatusSchema = z.enum(sourceValidationStatusValues);
export type SourceValidationStatus = z.infer<typeof sourceValidationStatusSchema>;
