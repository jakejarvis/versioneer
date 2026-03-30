import { normalizeAliasValue } from "@versioneer/core/identity";
import { toGitHubApiReleasesUrl } from "@versioneer/core/validation";
import { appAliases, generateId, idPrefixes, sources } from "@versioneer/db";
import { and, eq, ne } from "drizzle-orm";

type SourceType = (typeof sources.$inferSelect)["sourceType"];
type DerivedAliasType = "sparkle_feed" | "github_repo";

import type { DbExecutor } from "./db-types";

function sourceAliasTag(sourceId: string, aliasType: DerivedAliasType): string {
  return `source:${sourceId}:${aliasType}`;
}

function resolveDerivedAlias(
  sourceType: SourceType,
  baseUrl: string | null,
): { aliasType: DerivedAliasType; value: string; normalizedValue: string } | null {
  if (!baseUrl) return null;

  if (sourceType === "sparkle") {
    return {
      aliasType: "sparkle_feed",
      value: baseUrl,
      normalizedValue: normalizeAliasValue("sparkle_feed", baseUrl),
    };
  }

  if (sourceType === "github_releases") {
    const repoUrl = toGitHubRepoUrl(baseUrl);
    return {
      aliasType: "github_repo",
      value: repoUrl,
      normalizedValue: normalizeAliasValue("github_repo", repoUrl),
    };
  }

  return null;
}

export function toGitHubRepoUrl(url: string): string {
  const match = url.match(/repos\/([^/]+)\/([^/]+)\/releases$/);
  if (match) {
    return `https://github.com/${match[1]}/${match[2]}`;
  }
  return url;
}

export function normalizeSourceBaseUrl(
  sourceType: SourceType,
  baseUrl: string | null,
): string | null {
  if (!baseUrl) return null;
  if (sourceType === "github_releases") {
    return toGitHubApiReleasesUrl(baseUrl) ?? baseUrl;
  }
  return baseUrl;
}

export async function syncSourceDerivedAliases(params: {
  db: DbExecutor;
  appId: string;
  sourceId: string;
  sourceType: SourceType;
  baseUrl: string | null;
  now: string;
}): Promise<void> {
  const derived = resolveDerivedAlias(params.sourceType, params.baseUrl);
  const supportedAliasTypes: DerivedAliasType[] =
    params.sourceType === "sparkle"
      ? ["sparkle_feed"]
      : params.sourceType === "github_releases"
        ? ["github_repo"]
        : [];

  for (const aliasType of supportedAliasTypes) {
    const where = [
      eq(appAliases.appId, params.appId),
      eq(appAliases.aliasType, aliasType),
      eq(appAliases.source, sourceAliasTag(params.sourceId, aliasType)),
      eq(appAliases.isActive, true),
    ];
    if (derived) {
      where.push(ne(appAliases.normalizedValue, derived.normalizedValue));
    }
    await params.db
      .update(appAliases)
      .set({ isActive: false })
      .where(and(...where));
  }

  if (!derived) return;

  const tag = sourceAliasTag(params.sourceId, derived.aliasType);
  const existingOwned = await params.db
    .select({
      id: appAliases.id,
      isActive: appAliases.isActive,
      value: appAliases.value,
    })
    .from(appAliases)
    .where(
      and(
        eq(appAliases.appId, params.appId),
        eq(appAliases.aliasType, derived.aliasType),
        eq(appAliases.source, tag),
        eq(appAliases.normalizedValue, derived.normalizedValue),
      ),
    )
    .get();

  if (existingOwned) {
    if (!existingOwned.isActive || existingOwned.value !== derived.value) {
      await params.db
        .update(appAliases)
        .set({
          value: derived.value,
          isActive: true,
        })
        .where(eq(appAliases.id, existingOwned.id));
    }
    return;
  }

  const existingAny = await params.db
    .select({ id: appAliases.id })
    .from(appAliases)
    .where(
      and(
        eq(appAliases.appId, params.appId),
        eq(appAliases.aliasType, derived.aliasType),
        eq(appAliases.normalizedValue, derived.normalizedValue),
        eq(appAliases.isActive, true),
      ),
    )
    .get();
  if (existingAny) return;

  await params.db.insert(appAliases).values({
    id: generateId(idPrefixes.alias),
    appId: params.appId,
    aliasType: derived.aliasType,
    value: derived.value,
    normalizedValue: derived.normalizedValue,
    isExact: true,
    priority: 0,
    confidenceWeight: 100,
    source: tag,
    isActive: true,
    createdAt: params.now,
  });
}
