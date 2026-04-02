import type { SourceType } from "@versioneer/schemas/sources";

import { defaultDescriptor } from "./default";
import { electronGenericDescriptor } from "./electron-generic";
import { githubReleasesDescriptor } from "./github-releases";
import { homebrewCaskDescriptor } from "./homebrew-cask";
import { macAppStoreDescriptor } from "./mac-app-store";
import { manualDescriptor } from "./manual";
import { sparkleDescriptor } from "./sparkle";
import type { SourceTypeDescriptor } from "./types";

export type { SourceTypeDescriptor, FetchTokens } from "./types";

const SOURCE_TYPE_DESCRIPTORS: Record<SourceType, SourceTypeDescriptor> = {
  sparkle: sparkleDescriptor,
  github_releases: githubReleasesDescriptor,
  electron_generic: electronGenericDescriptor,
  homebrew_cask: homebrewCaskDescriptor,
  mac_app_store: macAppStoreDescriptor,
  manual: manualDescriptor,
  web_page: defaultDescriptor,
  regex: defaultDescriptor,
  json: defaultDescriptor,
  xml: defaultDescriptor,
};

export function getDescriptor(sourceType: SourceType): SourceTypeDescriptor {
  return SOURCE_TYPE_DESCRIPTORS[sourceType];
}

/**
 * Converts a type-specific source identifier into a fetchable URL.
 */
export function resolveSourceUrl(sourceType: SourceType, identifier: string): string | null {
  const trimmed = identifier.trim();
  if (!trimmed) return null;
  return getDescriptor(sourceType).resolveUrl(trimmed);
}

/**
 * Extracts the type-specific identifier from a stored baseUrl.
 * Inverse of {@link resolveSourceUrl}.
 */
export function extractSourceIdentifier(sourceType: SourceType, baseUrl: string | null): string {
  if (!baseUrl) return "";
  return getDescriptor(sourceType).extractIdentifier(baseUrl);
}

/**
 * Normalizes a baseUrl by round-tripping through extractIdentifier → resolveUrl.
 * Idempotent — a URL that's already resolved won't be double-encoded.
 */
export function normalizeBaseUrl(sourceType: SourceType, baseUrl: string): string {
  const d = getDescriptor(sourceType);
  return d.resolveUrl(d.extractIdentifier(baseUrl)) ?? baseUrl;
}
