/** Returns true if `current` >= `minimum` using numeric version comparison. */
export function isOsVersionCompatible(
  current: string | null | undefined,
  minimum: string | null,
): boolean {
  if (!minimum) return true; // No minimum means compatible with any OS
  if (!current) return true; // Unknown client OS, assume compatible
  const curParts = current.split(".").map(Number);
  const minParts = minimum.split(".").map(Number);
  for (let i = 0; i < Math.max(curParts.length, minParts.length); i++) {
    const c = curParts[i] ?? 0;
    const m = minParts[i] ?? 0;
    if (c > m) return true;
    if (c < m) return false;
  }
  return true; // equal
}

/** Returns true if an artifact's architecture is compatible with the client's. */
export function isArchCompatible(
  artifactArch: string | null,
  clientArch: string | null | undefined,
): boolean {
  if (!artifactArch) return true; // Unspecified artifact arch = universal/any
  if (!clientArch) return true; // Unknown client arch, assume compatible
  if (artifactArch === "universal") return true;
  return artifactArch === clientArch;
}

import { msElapsedSince } from "@versioneer/core/dates";

const STALENESS_THRESHOLD_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

/** Returns ISO date string if the source is stale (>30 days since last success), null otherwise. */
export function computeStaleSince(lastSuccessAt: string | null): string | null {
  if (!lastSuccessAt) return null;
  const elapsed = msElapsedSince(lastSuccessAt);
  if (elapsed !== null && elapsed >= STALENESS_THRESHOLD_MS) {
    return lastSuccessAt;
  }
  return null;
}
