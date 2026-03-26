export type InstallabilityClass =
  | "notify_only"
  | "assisted_download"
  | "assisted_replace"
  | "automation_candidate";

export function classifyInstallability(params: {
  verificationTier: string | null;
  installRule: { strategy: string; enabled: boolean } | null;
  hasArtifact: boolean;
}): InstallabilityClass {
  const { verificationTier, installRule, hasArtifact } = params;

  // No install rule or unverified → notify only
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

  // Verified + Sparkle strategy → automation candidate
  if (verificationTier === "verified" && installRule.strategy === "sparkle") {
    return "automation_candidate";
  }

  // Verified + supported install strategy → assisted replace
  if (verificationTier === "verified") {
    return "assisted_replace";
  }

  // Provisional + supported install strategy → assisted download
  if (verificationTier === "provisional") {
    return "assisted_download";
  }

  return "notify_only";
}
