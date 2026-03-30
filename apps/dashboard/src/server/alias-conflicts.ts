import {
  type AliasType,
  isGloballyUniqueExactAliasType,
  normalizeAliasValue,
} from "@versioneer/core/identity";
import { appAliases } from "@versioneer/db";
import { and, eq, ne } from "drizzle-orm";

import type { DbExecutor } from "./db-types";

export class AliasConflictError extends Error {
  readonly aliasId: string;
  readonly appId: string;
  readonly aliasType: AliasType;
  readonly value: string;

  constructor(params: { aliasId: string; appId: string; aliasType: AliasType; value: string }) {
    super(
      `Conflicting ${params.aliasType.replaceAll("_", " ")} alias already belongs to another app`,
    );
    this.aliasId = params.aliasId;
    this.appId = params.appId;
    this.aliasType = params.aliasType;
    this.value = params.value;
  }
}

export async function findConflictingExactAlias(
  db: DbExecutor,
  params: {
    aliasType: AliasType;
    value: string;
    appId?: string | null;
    excludeAliasId?: string | null;
    isExact?: boolean;
    isActive?: boolean;
  },
) {
  if (
    !params.value ||
    params.isExact === false ||
    params.isActive === false ||
    !isGloballyUniqueExactAliasType(params.aliasType)
  ) {
    return null;
  }

  const clauses = [
    eq(appAliases.aliasType, params.aliasType),
    eq(appAliases.normalizedValue, normalizeAliasValue(params.aliasType, params.value)),
    eq(appAliases.isExact, true),
    eq(appAliases.isActive, true),
  ];
  if (params.appId) {
    clauses.push(ne(appAliases.appId, params.appId));
  }
  if (params.excludeAliasId) {
    clauses.push(ne(appAliases.id, params.excludeAliasId));
  }

  return db
    .select({
      id: appAliases.id,
      appId: appAliases.appId,
      aliasType: appAliases.aliasType,
      value: appAliases.value,
      normalizedValue: appAliases.normalizedValue,
    })
    .from(appAliases)
    .where(and(...clauses))
    .get();
}

export async function assertNoConflictingExactAlias(
  db: DbExecutor,
  params: {
    aliasType: AliasType;
    value: string;
    appId?: string | null;
    excludeAliasId?: string | null;
    isExact?: boolean;
    isActive?: boolean;
  },
): Promise<void> {
  const conflict = await findConflictingExactAlias(db, params);
  if (!conflict) return;

  throw new AliasConflictError({
    aliasId: conflict.id,
    appId: conflict.appId,
    aliasType: params.aliasType,
    value: params.value,
  });
}
