export function latestReleaseKey(
  appId: string,
  channel: string,
  targetArchitecture: string,
): string {
  return `latest:app:${appId}:${channel}:${targetArchitecture}`;
}

export function bundleLookupKey(bundleId: string): string {
  return `lookup:bundle:${bundleId.toLowerCase()}`;
}

export function recentReleasesKey(): string {
  return "recent-releases";
}

export function dismissedBundleIdsKey(): string {
  return "dismissed-bundle-ids";
}
