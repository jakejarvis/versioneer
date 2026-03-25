import { z } from "zod";

export const appCreateSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9-]+$/, "Slug must be lowercase alphanumeric with hyphens"),
  canonicalName: z.string().min(1).max(500),
  vendorName: z.string().max(500).optional(),
  homepageUrl: z.string().url().max(2000).optional(),
  notes: z.string().max(5000).optional(),
});

export const appUpdateSchema = z.object({
  canonicalName: z.string().min(1).max(500).optional(),
  vendorName: z.string().max(500).nullable().optional(),
  homepageUrl: z.string().url().max(2000).nullable().optional(),
  status: z.enum(["active", "deprecated", "merged", "unlisted"]).optional(),
  mergedIntoAppId: z.string().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  verificationTier: z.enum(["unverified", "provisional", "verified"]).optional(),
  qualityState: z.enum(["green", "yellow", "red", "unknown"]).optional(),
  lastReviewedAt: z.string().nullable().optional(),
});

export const aliasCreateSchema = z.object({
  aliasType: z.enum([
    "bundle_id",
    "name",
    "team_id",
    "sparkle_feed",
    "homepage",
    "download_pattern",
    "github_repo",
  ]),
  value: z.string().min(1).max(2000),
  normalizedValue: z.string().min(1).max(2000).optional(),
  isExact: z.boolean().default(true),
  priority: z.number().int().default(0),
  confidenceWeight: z.number().int().min(0).max(100).default(100),
  source: z.string().max(200).optional(),
});

export const aliasUpdateSchema = z.object({
  isActive: z.boolean().optional(),
  priority: z.number().int().optional(),
  confidenceWeight: z.number().int().min(0).max(100).optional(),
});

export const sourceCreateSchema = z.object({
  appId: z.string().min(1),
  sourceType: z.enum(["sparkle", "github_releases", "manual"]),
  label: z.string().max(500).optional(),
  baseUrl: z.string().url().max(2000).optional(),
  configJson: z.string().max(10000).optional(),
  parserKey: z.string().min(1).max(200),
  pollIntervalMinutes: z.number().int().min(5).max(10080).default(60),
});

export const sourceUpdateSchema = z.object({
  label: z.string().max(500).nullable().optional(),
  baseUrl: z.string().url().max(2000).nullable().optional(),
  configJson: z.string().max(10000).nullable().optional(),
  parserKey: z.string().min(1).max(200).optional(),
  pollIntervalMinutes: z.number().int().min(5).max(10080).optional(),
  status: z.enum(["active", "paused", "disabled", "error"]).optional(),
});

export const releaseUpdateSchema = z.object({
  status: z.enum(["active", "retracted", "superseded", "draft"]).optional(),
  channel: z.enum(["stable", "beta", "nightly"]).optional(),
});

export const installRuleCreateSchema = z.object({
  strategy: z.enum(["sparkle", "zip_replace", "dmg_copy_replace", "pkg_manual", "manual_only"]),
  requiresQuit: z.boolean().default(true),
  requiresAdmin: z.boolean().default(false),
  supportsSilent: z.boolean().default(false),
  rollbackSupported: z.boolean().default(false),
  ruleConfidence: z.number().int().min(0).max(100).optional(),
  notes: z.string().max(5000).optional(),
});

export const installRuleUpdateSchema = z.object({
  strategy: z
    .enum(["sparkle", "zip_replace", "dmg_copy_replace", "pkg_manual", "manual_only"])
    .optional(),
  requiresQuit: z.boolean().optional(),
  requiresAdmin: z.boolean().optional(),
  supportsSilent: z.boolean().optional(),
  rollbackSupported: z.boolean().optional(),
  ruleConfidence: z.number().int().min(0).max(100).nullable().optional(),
  enabled: z.boolean().optional(),
  notes: z.string().max(5000).nullable().optional(),
});

export const overrideCreateSchema = z.object({
  overrideType: z.string().min(1).max(200),
  targetType: z.string().min(1).max(200),
  targetId: z.string().min(1).max(200),
  payloadJson: z.string().min(1).max(50000),
  reason: z.string().max(5000).optional(),
  createdBy: z.string().max(200).optional(),
});

export const onboardingChecklistUpdateSchema = z.object({
  hasCanonicalRecord: z.boolean().optional(),
  hasAliases: z.boolean().optional(),
  hasSource: z.boolean().optional(),
  parserOutputVerified: z.boolean().optional(),
  latestReleasePublished: z.boolean().optional(),
  reviewQueueClear: z.boolean().optional(),
  qualityScoreAcceptable: z.boolean().optional(),
});

export type OnboardingChecklistUpdateInput = z.infer<typeof onboardingChecklistUpdateSchema>;
export type AppCreateInput = z.infer<typeof appCreateSchema>;
export type AppUpdateInput = z.infer<typeof appUpdateSchema>;
export type AliasCreateInput = z.infer<typeof aliasCreateSchema>;
export type AliasUpdateInput = z.infer<typeof aliasUpdateSchema>;
export type SourceCreateInput = z.infer<typeof sourceCreateSchema>;
export type SourceUpdateInput = z.infer<typeof sourceUpdateSchema>;
export type ReleaseUpdateInput = z.infer<typeof releaseUpdateSchema>;
export type InstallRuleCreateInput = z.infer<typeof installRuleCreateSchema>;
export type InstallRuleUpdateInput = z.infer<typeof installRuleUpdateSchema>;
export type OverrideCreateInput = z.infer<typeof overrideCreateSchema>;
