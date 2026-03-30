import { z } from "zod";

// --- sourceType ---

export const sourceTypeValues = [
  "sparkle",
  "github_releases",
  "manual",
  "homebrew_cask",
  "mac_app_store",
  "electron_generic",
  "rss_feed",
  "json_feed",
  "web_page",
  "regex",
  "json",
  "xml",
] as const;
export const sourceTypeSchema = z.enum(sourceTypeValues);
export type SourceType = z.infer<typeof sourceTypeSchema>;

// --- reviewStatus ---

export const reviewStatusValues = ["pending", "approved", "rejected", "disabled"] as const;
export const reviewStatusSchema = z.enum(reviewStatusValues);
export type ReviewStatus = z.infer<typeof reviewStatusSchema>;

// --- role ---

export const sourceRoleValues = ["authority", "corroborating", "reference"] as const;
export const sourceRoleSchema = z.enum(sourceRoleValues);
export type SourceRole = z.infer<typeof sourceRoleSchema>;

// --- source status ---

export const sourceStatusValues = ["active", "paused", "disabled", "error"] as const;
export const sourceStatusSchema = z.enum(sourceStatusValues);
export type SourceStatus = z.infer<typeof sourceStatusSchema>;

// --- fetchStatus ---

export const fetchStatusValues = ["success", "not_modified", "error", "timeout"] as const;
export const fetchStatusSchema = z.enum(fetchStatusValues);
export type FetchStatus = z.infer<typeof fetchStatusSchema>;

// --- runStatus ---

export const runStatusValues = ["success", "partial", "error"] as const;
export const runStatusSchema = z.enum(runStatusValues);
export type RunStatus = z.infer<typeof runStatusSchema>;

// --- Source type defaults ---

export interface SourceTypeDefaults {
  parserKey: string;
  defaultRole: SourceRole;
  defaultRuntimeStatus: Extract<SourceStatus, "active" | "disabled">;
  pollIntervalMinutes: number;
  validatable: boolean;
}

export const SOURCE_TYPE_DEFAULTS: Record<SourceType, SourceTypeDefaults> = {
  sparkle: {
    parserKey: "sparkle",
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
    pollIntervalMinutes: 60,
    validatable: true,
  },
  github_releases: {
    parserKey: "github_releases",
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
    pollIntervalMinutes: 60,
    validatable: true,
  },
  homebrew_cask: {
    parserKey: "homebrew_cask",
    defaultRole: "corroborating",
    defaultRuntimeStatus: "active",
    pollIntervalMinutes: 360,
    validatable: true,
  },
  mac_app_store: {
    parserKey: "mac_app_store",
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
    pollIntervalMinutes: 1440,
    validatable: true,
  },
  electron_generic: {
    parserKey: "electron_generic",
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
    pollIntervalMinutes: 60,
    validatable: true,
  },
  rss_feed: {
    parserKey: "rss_reference",
    defaultRole: "reference",
    defaultRuntimeStatus: "disabled",
    pollIntervalMinutes: 360,
    validatable: false,
  },
  json_feed: {
    parserKey: "json_reference",
    defaultRole: "reference",
    defaultRuntimeStatus: "disabled",
    pollIntervalMinutes: 360,
    validatable: false,
  },
  web_page: {
    parserKey: "web_page",
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
    pollIntervalMinutes: 1440,
    validatable: true,
  },
  regex: {
    parserKey: "regex",
    defaultRole: "corroborating",
    defaultRuntimeStatus: "active",
    pollIntervalMinutes: 1440,
    validatable: true,
  },
  json: {
    parserKey: "json",
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
    pollIntervalMinutes: 1440,
    validatable: true,
  },
  xml: {
    parserKey: "xml",
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
    pollIntervalMinutes: 1440,
    validatable: true,
  },
  manual: {
    parserKey: "manual",
    defaultRole: "authority",
    defaultRuntimeStatus: "active",
    pollIntervalMinutes: 1440,
    validatable: false,
  },
};

export function defaultParserKeyForSourceType(sourceType: SourceType): string {
  return SOURCE_TYPE_DEFAULTS[sourceType].parserKey;
}

export function defaultRoleForSourceType(sourceType: SourceType): SourceRole {
  return SOURCE_TYPE_DEFAULTS[sourceType].defaultRole;
}

export function defaultRuntimeStatusForSourceType(
  sourceType: SourceType,
): Extract<SourceStatus, "active" | "disabled"> {
  return SOURCE_TYPE_DEFAULTS[sourceType].defaultRuntimeStatus;
}

export function defaultPollIntervalForSourceType(sourceType: SourceType): number {
  return SOURCE_TYPE_DEFAULTS[sourceType].pollIntervalMinutes;
}
