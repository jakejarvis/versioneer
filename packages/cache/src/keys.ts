export function latestReleaseKey(appId: string, channel: string): string {
  return `latest:app:${appId}:${channel}`;
}

export function bundleLookupKey(bundleId: string): string {
  return `lookup:bundle:${bundleId.toLowerCase()}`;
}

export function teamLookupKey(teamId: string): string {
  return `lookup:team:${teamId.toLowerCase()}`;
}

export function featureFlagKey(flag: string): string {
  return `feature:${flag}`;
}

export function blockSourceKey(sourceId: string): string {
  return `block:source:${sourceId}`;
}
