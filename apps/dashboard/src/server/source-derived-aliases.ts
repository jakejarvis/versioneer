import { normalizeAliasValue } from "@versioneer/core/identity";
import { resolveSourceUrl } from "@versioneer/core/validation";
import { appAliases, generateId, idPrefixes } from "@versioneer/db";
import type { SourceType } from "@versioneer/schemas/sources";
import { and, eq, ne } from "drizzle-orm";

import type { Db, DbExecutor } from "./db-types";

type DerivedAliasType = "sparkle_feed" | "github_repo";

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
  // resolveSourceUrl handles identifier → URL for all types
  // (e.g. "owner/repo" → GitHub API URL, "firefox" → Homebrew API URL)
  return resolveSourceUrl(sourceType, baseUrl) ?? baseUrl;
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

/**
 * For onboarding (brand-new app with no existing aliases): returns insert
 * query builders for source-derived aliases without any reads.
 */
export function buildSourceDerivedAliasInserts(
  db: Db,
  params: {
    appId: string;
    sourceId: string;
    sourceType: SourceType;
    baseUrl: string | null;
    now: string;
  },
) {
  const derived = resolveDerivedAlias(params.sourceType, params.baseUrl);
  if (!derived) return [];

  const tag = sourceAliasTag(params.sourceId, derived.aliasType);
  return [
    db.insert(appAliases).values({
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
    }),
  ];
}

/**
 * For existing apps (createSource / updateSource): performs reads first, then
 * returns an array of write query builders to include in a db.batch() call.
 */
export async function prepareSyncSourceDerivedAliasWrites(
  db: Db,
  params: {
    appId: string;
    sourceId: string;
    sourceType: SourceType;
    baseUrl: string | null;
    now: string;
  },
) {
  const derived = resolveDerivedAlias(params.sourceType, params.baseUrl);
  const supportedAliasTypes: DerivedAliasType[] =
    params.sourceType === "sparkle"
      ? ["sparkle_feed"]
      : params.sourceType === "github_releases"
        ? ["github_repo"]
        : [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- collected for db.batch()
  const writes: any[] = [];

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
    writes.push(
      db
        .update(appAliases)
        .set({ isActive: false })
        .where(and(...where)),
    );
  }

  if (!derived) return writes;

  const tag = sourceAliasTag(params.sourceId, derived.aliasType);
  const existingOwned = await db
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
      writes.push(
        db
          .update(appAliases)
          .set({ value: derived.value, isActive: true })
          .where(eq(appAliases.id, existingOwned.id)),
      );
    }
    return writes;
  }

  const existingAny = await db
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
  if (existingAny) return writes;

  writes.push(
    db.insert(appAliases).values({
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
    }),
  );

  return writes;
}
