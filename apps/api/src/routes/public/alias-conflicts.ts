import { createDb } from "@versioneer/db";
import {
  type AppAliasType,
  isGloballyUniqueExactAliasType,
  normalizeAliasValue,
} from "@versioneer/identity";
import { appAliases } from "@versioneer/schema";
import { and, eq, ne } from "drizzle-orm";

type Db = ReturnType<typeof createDb>;

export async function findConflictingExactAlias(
  db: Db,
  params: {
    aliasType: AppAliasType;
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
