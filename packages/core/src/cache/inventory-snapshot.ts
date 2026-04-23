import { and, eq, inArray } from "drizzle-orm";

import { appAliases, apps, trustAssertions } from "@versioneer/db";
import type { createDb } from "@versioneer/db";

import type { AliasRecord, TrustAssertionRecord } from "../identity";
import { inventoryMatchSnapshotKey } from "./keys";
import type { CacheKV } from "./types";

export const INVENTORY_MATCH_SNAPSHOT_TTL_SECONDS = 300;

export interface InventorySnapshotApp {
  canonicalName: string;
  iconR2Key: string | null;
  status: "draft" | "public" | "merged" | "deprecated" | "unlisted";
}

export interface InventoryMatchSnapshot {
  version: 1;
  generatedAt: string;
  appsById: Record<string, InventorySnapshotApp>;
  aliases: AliasRecord[];
  caskTokenByAppId: Record<string, string>;
  sparkleTrustAssertions: TrustAssertionRecord[];
}

type Db = ReturnType<typeof createDb>;

const INVENTORY_MATCH_ALIAS_TYPES = [
  "bundle_id",
  "name",
  "team_id",
  "sparkle_feed",
  "mas_app_id",
  "electron_update_url",
  "homebrew_cask",
] as const;

function preferredAliasMap(
  aliases: Array<{
    appId: string;
    aliasType: string;
    value: string;
    isExact: boolean;
    confidenceWeight: number;
  }>,
  aliasType: string,
): Record<string, string> {
  const map = new Map<string, { value: string; confidenceWeight: number }>();

  for (const alias of aliases) {
    if (alias.aliasType !== aliasType || !alias.isExact) continue;
    const existing = map.get(alias.appId);
    if (!existing || alias.confidenceWeight > existing.confidenceWeight) {
      map.set(alias.appId, { value: alias.value, confidenceWeight: alias.confidenceWeight });
    }
  }

  return Object.fromEntries([...map].map(([appId, entry]) => [appId, entry.value]));
}

function parseSnapshot(raw: string): InventoryMatchSnapshot | null {
  try {
    const parsed = JSON.parse(raw) as Partial<InventoryMatchSnapshot>;
    if (parsed.version !== 1) return null;
    if (!parsed.appsById || !Array.isArray(parsed.aliases)) return null;
    if (!parsed.caskTokenByAppId || !Array.isArray(parsed.sparkleTrustAssertions)) return null;
    return parsed as InventoryMatchSnapshot;
  } catch {
    return null;
  }
}

export async function buildInventoryMatchSnapshot(db: Db): Promise<InventoryMatchSnapshot> {
  const appRows = await db
    .select({
      id: apps.id,
      canonicalName: apps.canonicalName,
      iconR2Key: apps.iconR2Key,
      status: apps.status,
    })
    .from(apps)
    .all();

  const appsById: Record<string, InventorySnapshotApp> = {};
  for (const app of appRows) {
    appsById[app.id] = {
      canonicalName: app.canonicalName,
      iconR2Key: app.iconR2Key,
      status: app.status,
    };
  }

  const aliasRows = await db
    .select({
      appId: appAliases.appId,
      aliasType: appAliases.aliasType,
      value: appAliases.value,
      normalizedValue: appAliases.normalizedValue,
      isExact: appAliases.isExact,
      confidenceWeight: appAliases.confidenceWeight,
    })
    .from(appAliases)
    .where(
      and(
        eq(appAliases.isActive, true),
        inArray(appAliases.aliasType, INVENTORY_MATCH_ALIAS_TYPES),
      ),
    )
    .all();

  const aliases: AliasRecord[] = aliasRows.map((alias) => ({
    appId: alias.appId,
    appName: appsById[alias.appId]?.canonicalName ?? "Unknown",
    aliasType: alias.aliasType,
    value: alias.value,
    normalizedValue: alias.normalizedValue,
    isExact: alias.isExact,
    confidenceWeight: alias.confidenceWeight,
  }));

  const sparkleTrustAssertions = (
    await db
      .select({
        appId: trustAssertions.appId,
        assertionType: trustAssertions.assertionType,
        value: trustAssertions.value,
      })
      .from(trustAssertions)
      .where(eq(trustAssertions.assertionType, "sparkle_public_key"))
      .all()
  ).flatMap((assertion): TrustAssertionRecord[] =>
    assertion.appId
      ? [
          {
            appId: assertion.appId,
            assertionType: assertion.assertionType,
            value: assertion.value,
          },
        ]
      : [],
  );

  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    appsById,
    aliases,
    caskTokenByAppId: preferredAliasMap(aliasRows, "homebrew_cask"),
    sparkleTrustAssertions,
  };
}

export async function getInventoryMatchSnapshot(params: {
  db: Db;
  kv: CacheKV;
  ttlSeconds?: number;
}): Promise<InventoryMatchSnapshot> {
  const key = inventoryMatchSnapshotKey();
  const cached = await params.kv.get(key);
  if (cached) {
    const snapshot = parseSnapshot(cached);
    if (snapshot) return snapshot;
    await params.kv.delete(key);
  }

  const snapshot = await buildInventoryMatchSnapshot(params.db);
  await params.kv.put(key, JSON.stringify(snapshot), {
    expirationTtl: params.ttlSeconds ?? INVENTORY_MATCH_SNAPSHOT_TTL_SECONDS,
  });
  return snapshot;
}

export async function deleteInventoryMatchSnapshot(kv: CacheKV): Promise<void> {
  await kv.delete(inventoryMatchSnapshotKey());
}
