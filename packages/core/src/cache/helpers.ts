import {
  latestReleaseKey,
  bundleLookupKey,
  recentReleasesKey,
  dismissedBundleIdsKey,
} from "./keys";
import type { CacheKV } from "./types";

export interface CachedLatestRelease {
  appId: string;
  releaseId: string;
  versionNormalized: string;
  versionRaw: string;
  channel: string;
  targetArchitecture: string;
  releasedAt: string | null;
  updatedAt: string;
}

const DEFAULT_TTL = 3600; // 1 hour

export async function getCachedLatest(
  kv: CacheKV,
  appId: string,
  channel: string = "stable",
  targetArchitecture: string = "arm64",
): Promise<CachedLatestRelease | null> {
  const raw = await kv.get(latestReleaseKey(appId, channel, targetArchitecture));
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
  await kv.put(
    latestReleaseKey(data.appId, data.channel, data.targetArchitecture),
    JSON.stringify(data),
    {
      expirationTtl: ttl,
    },
  );
}

export async function deleteCachedLatest(
  kv: CacheKV,
  appId: string,
  channel: string,
  targetArchitecture: string,
): Promise<void> {
  await kv.delete(latestReleaseKey(appId, channel, targetArchitecture));
}

export interface CachedRecentRelease {
  appId: string;
  appName: string;
  appSlug: string;
  vendorName: string | null;
  iconUrl: string | null;
  releaseId: string;
  version: string;
  releasedAt: string;
}

export async function getCachedRecentReleases(kv: CacheKV): Promise<CachedRecentRelease[] | null> {
  const raw = await kv.get(recentReleasesKey());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as CachedRecentRelease[];
  } catch {
    return null;
  }
}

export async function setCachedRecentReleases(
  kv: CacheKV,
  data: CachedRecentRelease[],
  ttl: number = DEFAULT_TTL,
): Promise<void> {
  await kv.put(recentReleasesKey(), JSON.stringify(data), {
    expirationTtl: ttl,
  });
}

export async function getCachedDismissedBundleIds(kv: CacheKV): Promise<string[] | null> {
  const raw = await kv.get(dismissedBundleIdsKey());
  if (!raw) return null;
  try {
    return JSON.parse(raw) as string[];
  } catch {
    return null;
  }
}

export async function setCachedDismissedBundleIds(
  kv: CacheKV,
  ids: string[],
  ttl: number = DEFAULT_TTL,
): Promise<void> {
  await kv.put(dismissedBundleIdsKey(), JSON.stringify(ids), {
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
