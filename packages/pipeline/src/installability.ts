export type InstallabilityClass =
  | "notify_only"
  | "assisted_download"
  | "assisted_replace"
  | "automation_candidate";

export function classifyInstallability(params: {
  verificationTier: string | null;
  installRule: { strategy: string; enabled: boolean } | null;
  artifactTrustLevel: string;
  sourceQuality: number | null;
}): InstallabilityClass {
  const { verificationTier, installRule, artifactTrustLevel } = params;

  // No install rule or unverified → notify only
  if (
    !installRule ||
    !installRule.enabled ||
    verificationTier === "unverified" ||
    !verificationTier
  ) {
    return "notify_only";
  }

  const highTrust = artifactTrustLevel === "high";
  const mediumPlusTrust = highTrust || artifactTrustLevel === "medium";

  // Verified + high trust + sparkle strategy → automation candidate
  if (verificationTier === "verified" && highTrust && installRule.strategy === "sparkle") {
    return "automation_candidate";
  }

  // Verified + medium+ trust + any rule → assisted replace
  if (verificationTier === "verified" && mediumPlusTrust) {
    return "assisted_replace";
  }

  // Provisional + medium+ trust + rule → assisted download
  if (verificationTier === "provisional" && mediumPlusTrust) {
    return "assisted_download";
  }

  return "notify_only";
}
