export function latestReleaseKey(appId: string, channel: string): string {
  return `latest:app:${appId}:${channel}`;
}

export function bundleLookupKey(bundleId: string): string {
  return `lookup:bundle:${bundleId.toLowerCase()}`;
}

export function recentReleasesKey(): string {
  return "recent-releases";
}
