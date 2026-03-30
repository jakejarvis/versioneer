import type { AliasType } from "@versioneer/schemas/catalog";

import { normalizeBundleId, normalizeName } from "./normalize";

const globallyUniqueExactAliasTypes = new Set<AliasType>([
  "bundle_id",
  "sparkle_feed",
  "mas_app_id",
  "homebrew_cask",
]);

export function normalizeAliasValue(aliasType: AliasType | string, value: string): string {
  if (aliasType === "name") return normalizeName(value);
  if (aliasType === "bundle_id") return normalizeBundleId(value);
  return value.toLowerCase().trim();
}

export function isGloballyUniqueExactAliasType(
  aliasType: AliasType | string,
): aliasType is AliasType {
  return globallyUniqueExactAliasTypes.has(aliasType as AliasType);
}
