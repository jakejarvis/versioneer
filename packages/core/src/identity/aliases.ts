import { normalizeBundleId, normalizeName } from "./normalize";

export type AppAliasType =
  | "bundle_id"
  | "name"
  | "team_id"
  | "sparkle_feed"
  | "homepage"
  | "download_pattern"
  | "github_repo"
  | "mas_app_id"
  | "homebrew_cask";

const globallyUniqueExactAliasTypes = new Set<AppAliasType>([
  "bundle_id",
  "sparkle_feed",
  "mas_app_id",
  "homebrew_cask",
]);

export function normalizeAliasValue(aliasType: AppAliasType | string, value: string): string {
  if (aliasType === "name") return normalizeName(value);
  if (aliasType === "bundle_id") return normalizeBundleId(value);
  return value.toLowerCase().trim();
}

export function isGloballyUniqueExactAliasType(
  aliasType: AppAliasType | string,
): aliasType is AppAliasType {
  return globallyUniqueExactAliasTypes.has(aliasType as AppAliasType);
}
