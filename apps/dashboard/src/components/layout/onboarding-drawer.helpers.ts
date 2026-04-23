import { format } from "date-fns";

import { parseGitHubRepoUrl } from "@versioneer/core/validation";
import type { AliasType } from "@versioneer/schemas/catalog";
import type { SourceType } from "@versioneer/schemas/sources";

export type OnboardingAliasType = Extract<
  AliasType,
  "bundle_id" | "name" | "team_id" | "homebrew_cask" | "mas_app_id" | "electron_update_url"
>;

export interface AliasEntry {
  key: string;
  aliasType: OnboardingAliasType;
  value: string;
}

export interface SourceEntry {
  key: string;
  sourceType: SourceType;
  identifier: string;
  pollIntervalMinutes: number;
  label?: string;
  status?: "active" | "paused";
  config: Record<string, string>;
}

export interface OnboardingFormData {
  canonicalName: string;
  slug: string;
  vendorName: string;
  homepageUrl: string;
  notes: string;
  aliases: AliasEntry[];
  sources: SourceEntry[];
  sourceValidated: boolean;
}

export interface OnboardingDiscoveredApp {
  id: string;
  appName: string;
  bundleId: string | null;
  teamId: string | null;
  masAppId: string | null;
  sparkleFeedUrl: string | null;
  electronUpdateUrl: string | null;
  isMasApp: boolean | null;
  sourceValidationStatus: string | null;
  enrichedVendorName: string | null;
  enrichedHomepageUrl: string | null;
  enrichedReleaseCount: number | null;
  enrichedLatestVersion: string | null;
  enrichedLatestPublishedAt: string | null;
  iconR2Key: string | null;
  confidenceScore: number | null;
  electronUpdateProvider: string | null;
  minMacOSVersion: string | null;
  homebrewCaskToken: string | null;
}

function nextKey() {
  return crypto.randomUUID();
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function formatDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return format(date, "MMM d, yyyy");
}

export function reorderItems<T>(items: T[], fromIndex: number, toIndex: number): T[] {
  if (fromIndex === toIndex) return items;

  const reordered = [...items];
  const [moved] = reordered.splice(fromIndex, 1);
  if (moved === undefined) return items;
  reordered.splice(toIndex, 0, moved);
  return reordered;
}

export function buildInitialValues(discoveredApp: OnboardingDiscoveredApp): OnboardingFormData {
  const aliases: AliasEntry[] = [];
  if (discoveredApp.bundleId) {
    aliases.push({
      key: nextKey(),
      aliasType: "bundle_id",
      value: discoveredApp.bundleId,
    });
  }
  aliases.push({ key: nextKey(), aliasType: "name", value: discoveredApp.appName });
  if (discoveredApp.teamId) {
    aliases.push({
      key: nextKey(),
      aliasType: "team_id",
      value: discoveredApp.teamId,
    });
  }
  if (discoveredApp.masAppId) {
    aliases.push({
      key: nextKey(),
      aliasType: "mas_app_id",
      value: discoveredApp.masAppId,
    });
  }

  const sources: SourceEntry[] = [];
  if (discoveredApp.sparkleFeedUrl) {
    sources.push({
      key: nextKey(),
      sourceType: "sparkle",
      identifier: discoveredApp.sparkleFeedUrl,
      pollIntervalMinutes: 60,
      status: "active",
      config: {},
    });
  }
  if (discoveredApp.electronUpdateUrl) {
    const parsed = parseGitHubRepoUrl(discoveredApp.electronUpdateUrl);
    if (parsed) {
      sources.push({
        key: nextKey(),
        sourceType: "github_releases",
        identifier: `${parsed.owner}/${parsed.repo}`,
        pollIntervalMinutes: 60,
        status: "active",
        config: {},
      });
    } else {
      sources.push({
        key: nextKey(),
        sourceType: "electron_generic",
        identifier: discoveredApp.electronUpdateUrl,
        pollIntervalMinutes: 60,
        status: "active",
        config: {},
      });
    }
  }
  if (discoveredApp.isMasApp && discoveredApp.bundleId && sources.length === 0) {
    sources.push({
      key: nextKey(),
      sourceType: "mac_app_store",
      identifier: discoveredApp.bundleId,
      pollIntervalMinutes: 1440,
      status: "active",
      config: {},
    });
  }

  return {
    canonicalName: discoveredApp.appName,
    slug: slugify(discoveredApp.appName),
    vendorName: discoveredApp.enrichedVendorName ?? "",
    homepageUrl: discoveredApp.enrichedHomepageUrl ?? "",
    notes: "",
    aliases,
    sources,
    sourceValidated: discoveredApp.sourceValidationStatus === "valid",
  };
}
