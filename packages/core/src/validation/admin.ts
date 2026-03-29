import { z } from "zod";

import { channelSchema } from "./common";

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
  status: z.enum(["draft", "public", "deprecated", "merged", "unlisted"]).optional(),
  mergedIntoAppId: z.string().nullable().optional(),
  notes: z.string().max(5000).nullable().optional(),
  defaultReleaseNotesUrl: z.string().url().max(2000).nullable().optional(),
  iconR2Key: z.string().max(500).nullable().optional(),
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
    "mas_app_id",
    "homebrew_cask",
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
  sourceType: z.enum([
    "sparkle",
    "github_releases",
    "manual",
    "homebrew_cask",
    "mac_app_store",
    "electron_generic",
    "rss_feed",
    "json_feed",
    "web_page",
  ]),
  label: z.string().max(500).optional(),
  baseUrl: z.string().url().max(2000).optional(),
  configJson: z.string().max(10000).optional(),
  parserKey: z.string().min(1).max(200),
  channel: channelSchema.nullable().optional(),
  pollIntervalMinutes: z.number().int().min(5).max(10080).default(60),
  reviewStatus: z.enum(["pending", "approved", "rejected", "disabled"]).default("pending"),
  role: z.enum(["authority", "corroborating", "reference"]).nullable().optional(),
});

export const sourceUpdateSchema = z.object({
  label: z.string().max(500).nullable().optional(),
  baseUrl: z.string().url().max(2000).nullable().optional(),
  configJson: z.string().max(10000).nullable().optional(),
  parserKey: z.string().min(1).max(200).optional(),
  channel: channelSchema.nullable().optional(),
  pollIntervalMinutes: z.number().int().min(5).max(10080).optional(),
  reviewStatus: z.enum(["pending", "approved", "rejected", "disabled"]).optional(),
  role: z.enum(["authority", "corroborating", "reference"]).nullable().optional(),
  status: z.enum(["active", "paused", "disabled", "error"]).optional(),
});

export const releaseCreateSchema = z.object({
  appId: z.string().min(1),
  versionRaw: z.string().min(1).max(200),
  buildNumber: z.string().max(200).optional(),
  channel: channelSchema.default("stable"),
  releasedAt: z.string().max(50).optional(),
  releaseNotesHtml: z.string().max(500000).optional(),
  releaseNotesUrl: z.string().url().max(2000).optional(),
});

export const releaseUpdateSchema = z.object({
  status: z.enum(["active", "superseded", "draft"]).optional(),
  channel: channelSchema.optional(),
  releaseNotesHtml: z.string().max(500000).nullable().optional(),
  releaseNotesUrl: z.string().url().max(2000).nullable().optional(),
});

export const releasePinSchema = z.object({
  releaseId: z.string().min(1),
  channel: channelSchema.default("stable"),
});

export const releaseUnpinSchema = z.object({
  channel: channelSchema.default("stable"),
});

export type AppCreateInput = z.infer<typeof appCreateSchema>;
export type AppUpdateInput = z.infer<typeof appUpdateSchema>;
export type AliasCreateInput = z.infer<typeof aliasCreateSchema>;
export type AliasUpdateInput = z.infer<typeof aliasUpdateSchema>;
export type SourceCreateInput = z.infer<typeof sourceCreateSchema>;
export type SourceUpdateInput = z.infer<typeof sourceUpdateSchema>;
export type ReleaseCreateInput = z.infer<typeof releaseCreateSchema>;
export type ReleaseUpdateInput = z.infer<typeof releaseUpdateSchema>;
export type ReleasePinInput = z.infer<typeof releasePinSchema>;
export type ReleaseUnpinInput = z.infer<typeof releaseUnpinSchema>;
