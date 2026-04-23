import { and, eq, like, ne, or } from "drizzle-orm";

import { normalizeAliasValue } from "@versioneer/core/identity";
import { getDescriptor } from "@versioneer/core/sources";
import { appAliases, generateId, idPrefixes } from "@versioneer/db";
import type { AliasType } from "@versioneer/schemas/catalog";
import type { SourceType } from "@versioneer/schemas/sources";

import type { Db, DbExecutor } from "./db-types";

function sourceAliasTag(sourceId: string, aliasType: string): string {
  return `source:${sourceId}:${aliasType}`;
}

function sourceAliasTagPrefix(sourceId: string): string {
  return `source:${sourceId}:`;
}

function resolveDerivedAlias(
  sourceType: SourceType,
  baseUrl: string | null,
): { aliasType: AliasType; value: string; normalizedValue: string } | null {
  if (!baseUrl) return null;

  const derived = getDescriptor(sourceType).derivedAlias(baseUrl);
  if (!derived) return null;

  return {
    ...derived,
    normalizedValue: normalizeAliasValue(derived.aliasType, derived.value),
  };
}

export function shouldKeepDerivedSourceAlias(
  ownedAlias: { aliasType: AliasType; normalizedValue: string },
  derivedAlias: { aliasType: AliasType; normalizedValue: string } | null,
): boolean {
  return (
    derivedAlias !== null &&
    ownedAlias.aliasType === derivedAlias.aliasType &&
    ownedAlias.normalizedValue === derivedAlias.normalizedValue
  );
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
  const deactivateWhere = [
    eq(appAliases.appId, params.appId),
    like(appAliases.source, `${sourceAliasTagPrefix(params.sourceId)}%`),
    eq(appAliases.isActive, true),
  ];
  if (derived) {
    const deactivateMismatch = or(
      ne(appAliases.aliasType, derived.aliasType),
      ne(appAliases.normalizedValue, derived.normalizedValue),
    );
    if (deactivateMismatch) {
      deactivateWhere.push(deactivateMismatch);
    }
  }
  await params.db
    .update(appAliases)
    .set({ isActive: false })
    .where(and(...deactivateWhere));

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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- collected for db.batch()
  const writes: any[] = [];

  const deactivateWhere = [
    eq(appAliases.appId, params.appId),
    like(appAliases.source, `${sourceAliasTagPrefix(params.sourceId)}%`),
    eq(appAliases.isActive, true),
  ];
  if (derived) {
    const deactivateMismatch = or(
      ne(appAliases.aliasType, derived.aliasType),
      ne(appAliases.normalizedValue, derived.normalizedValue),
    );
    if (deactivateMismatch) {
      deactivateWhere.push(deactivateMismatch);
    }
  }
  writes.push(
    db
      .update(appAliases)
      .set({ isActive: false })
      .where(and(...deactivateWhere)),
  );

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
