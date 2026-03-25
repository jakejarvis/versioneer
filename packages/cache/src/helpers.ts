import { latestReleaseKey, bundleLookupKey } from "./keys";
import type { CacheKV } from "./types";

export interface CachedLatestRelease {
  appId: string;
  releaseId: string;
  versionNormalized: string;
  versionRaw: string;
  channel: string;
  releasedAt: string | null;
  updatedAt: string;
}

const DEFAULT_TTL = 3600; // 1 hour

export async function getCachedLatest(
  kv: CacheKV,
  appId: string,
  channel: string = "stable",
): Promise<CachedLatestRelease | null> {
  const raw = await kv.get(latestReleaseKey(appId, channel));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedLatestRelease;
  } catch {
    return null;
  }
}

export async function setCachedLatest(
  kv: CacheKV,
  data: CachedLatestRelease,
  ttl: number = DEFAULT_TTL,
): Promise<void> {
  await kv.put(latestReleaseKey(data.appId, data.channel), JSON.stringify(data), {
    expirationTtl: ttl,
  });
}

export async function getCachedBundleLookup(kv: CacheKV, bundleId: string): Promise<string | null> {
  return kv.get(bundleLookupKey(bundleId));
}

export async function setCachedBundleLookup(
  kv: CacheKV,
  bundleId: string,
  appId: string,
  ttl: number = DEFAULT_TTL,
): Promise<void> {
  await kv.put(bundleLookupKey(bundleId), appId, { expirationTtl: ttl });
}
