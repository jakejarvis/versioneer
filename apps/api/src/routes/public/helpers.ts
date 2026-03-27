import type { AppDecision } from "@versioneer/validation";

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

export function deriveInstallabilityClass(params: {
  verificationTier: string | null;
  installRule: { strategy: string; enabled: boolean } | null;
  hasArtifact: boolean;
}): NonNullable<AppDecision["install"]["installabilityClass"]> {
  const { verificationTier, installRule, hasArtifact } = params;

  if (
    !installRule ||
    !installRule.enabled ||
    verificationTier === "unverified" ||
    !verificationTier
  ) {
    return "notify_only";
  }

  if (installRule.strategy === "manual_only" || installRule.strategy === "pkg_manual") {
    return "notify_only";
  }

  const strategyAvailable = installRule.strategy === "sparkle" || hasArtifact;
  if (!strategyAvailable) {
    return "notify_only";
  }

  if (verificationTier === "verified" && installRule.strategy === "sparkle") {
    return "automation_candidate";
  }

  if (verificationTier === "verified") {
    return "assisted_replace";
  }

  if (verificationTier === "provisional") {
    return "assisted_download";
  }

  return "notify_only";
}
