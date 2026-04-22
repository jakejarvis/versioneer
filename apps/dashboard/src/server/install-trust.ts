import {
  artifactCompatibilityIsKnown,
  normalizeTargetArchitecture,
} from "@versioneer/schemas/architecture";

export function latestReleaseTrustWarnings(params: {
  installStrategy: string | null;
  artifact: { sha256: string | null; architecture?: string | null } | undefined;
  targetArchitecture?: string | null;
  trustTypes: Set<string>;
  aliasTypes: Set<string>;
}) {
  const warnings: string[] = [];
  const hasBundleId = params.trustTypes.has("bundle_id") || params.aliasTypes.has("bundle_id");
  const hasTeamId = params.trustTypes.has("team_id") || params.aliasTypes.has("team_id");
  const requiresArchitectureTrust =
    params.installStrategy === "sparkle" ||
    params.installStrategy === "zip_replace" ||
    params.installStrategy === "dmg_copy_replace" ||
    params.installStrategy === "pkg_install";

  switch (params.installStrategy) {
    case "zip_replace":
    case "dmg_copy_replace":
    case "pkg_install":
      if (!params.artifact) warnings.push("missing_artifact");
      if (!params.artifact?.sha256) warnings.push("missing_sha256");
      if (!hasBundleId) warnings.push("missing_bundle_id");
      if (!hasTeamId) warnings.push("missing_team_id");
      break;
    case "sparkle":
      if (!params.trustTypes.has("sparkle_public_key")) warnings.push("missing_sparkle_public_key");
      break;
    case "mac_app_store":
      warnings.push("mac_app_store_external");
      break;
    case "manual_only":
      warnings.push("manual_only");
      break;
    case null:
      warnings.push(params.aliasTypes.has("homebrew_cask") ? "homebrew_external" : "manual_only");
      break;
    default:
      warnings.push("unsupported_strategy");
      break;
  }

  if (
    requiresArchitectureTrust &&
    params.artifact?.architecture &&
    !artifactCompatibilityIsKnown(
      params.artifact.architecture,
      normalizeTargetArchitecture(params.targetArchitecture),
    )
  ) {
    warnings.push("unknown_architecture");
  }

  return warnings;
}
