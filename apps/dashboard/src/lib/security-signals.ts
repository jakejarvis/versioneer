export type SecuritySignalTone = "ready" | "warning" | "danger" | "external" | "neutral";

export interface SecuritySignalCopy {
  label: string;
  description: string;
  tone: SecuritySignalTone;
}

const unknownSignal: SecuritySignalCopy = {
  label: "Review needed",
  description: "This signal needs manual review.",
  tone: "warning",
};

export const installTrustReasonCopy: Record<string, SecuritySignalCopy> = {
  missing_artifact: {
    label: "Missing artifact",
    description: "No downloadable artifact is attached to the selected release.",
    tone: "danger",
  },
  missing_sha256: {
    label: "Missing SHA-256",
    description: "One-click replacement and package installs require an artifact hash.",
    tone: "danger",
  },
  missing_bundle_id: {
    label: "Missing bundle ID",
    description: "One-click replacement needs an expected bundle identifier.",
    tone: "danger",
  },
  missing_team_id: {
    label: "Missing team ID",
    description: "One-click replacement needs an expected signing team identifier.",
    tone: "danger",
  },
  missing_sparkle_public_key: {
    label: "Missing Sparkle key",
    description: "Sparkle installs require a local or approved public key.",
    tone: "danger",
  },
  mac_app_store_external: {
    label: "Mac App Store",
    description: "Updates are handled outside Versioneer through the Mac App Store.",
    tone: "external",
  },
  homebrew_external: {
    label: "Homebrew",
    description: "Updates are handled outside Versioneer through Homebrew.",
    tone: "external",
  },
  manual_only: {
    label: "Manual only",
    description: "This release intentionally does not expose a one-click install route.",
    tone: "neutral",
  },
  unsupported_strategy: {
    label: "Unsupported strategy",
    description: "This install strategy is not executable by the desktop app.",
    tone: "warning",
  },
};

export const sourceAnomalyCopy: Record<string, SecuritySignalCopy> = {
  blocked_fetch_url: {
    label: "Blocked fetch URL",
    description: "A source URL was blocked by the egress policy before fetch.",
    tone: "danger",
  },
  new_fetch_hostname: {
    label: "New fetch host",
    description: "A source fetched from a hostname not previously seen for this source.",
    tone: "warning",
  },
  new_artifact_hostname: {
    label: "New artifact host",
    description: "A parser produced an artifact URL from a new hostname.",
    tone: "warning",
  },
  missing_install_hash: {
    label: "Missing install hash",
    description: "An installable artifact was found without SHA-256 material.",
    tone: "danger",
  },
  parser_error_spike: {
    label: "Parser error spike",
    description: "The parser failed three consecutive times for this source.",
    tone: "warning",
  },
};

export const fetchFailureReasonCopy: Record<string, SecuritySignalCopy> = {
  invalid_url: {
    label: "Invalid URL",
    description: "The candidate fetch URL could not be parsed.",
    tone: "danger",
  },
  non_https: {
    label: "Non-HTTPS",
    description: "Source fetches only allow HTTPS URLs.",
    tone: "danger",
  },
  blocked_hostname: {
    label: "Blocked host",
    description: "The hostname is local, metadata, private, or otherwise reserved.",
    tone: "danger",
  },
  dns_failed: {
    label: "DNS failed",
    description: "The hostname could not be resolved for policy validation.",
    tone: "warning",
  },
  dns_no_public_addresses: {
    label: "No public DNS",
    description: "The hostname did not resolve to a public A or AAAA address.",
    tone: "danger",
  },
  blocked_resolved_address: {
    label: "Blocked address",
    description: "DNS resolved the hostname to a private, metadata, or reserved address.",
    tone: "danger",
  },
  timeout: {
    label: "Timeout",
    description: "The source fetch exceeded the request timeout.",
    tone: "warning",
  },
  body_limit: {
    label: "Body limit",
    description: "The response body exceeded the source fetch size limit.",
    tone: "warning",
  },
  http_error: {
    label: "HTTP error",
    description: "The fetch completed with a non-success HTTP status.",
    tone: "warning",
  },
  network_error: {
    label: "Network error",
    description: "The fetch failed before receiving a response.",
    tone: "warning",
  },
};

export const installStrategyLabels: Record<string, string> = {
  sparkle: "Sparkle",
  zip_replace: "ZIP replace",
  dmg_copy_replace: "DMG copy",
  pkg_install: "Package install",
  mac_app_store: "Mac App Store",
  manual_only: "Manual only",
};

export const failureJobTypeLabels: Record<string, string> = {
  "source-fetch": "Source Fetch",
  "source-parse": "Source Parse",
  "recompute-latest": "Recompute Latest",
  "source-anomaly": "Source Anomaly",
  poll_sources: "Poll Sources",
  cask_index_sync: "Cask Index Sync",
  enrich_discovered_apps: "Enrich Discoveries",
};

export const failureJobTypeOptions = [
  { value: "all", label: "All Failure Types" },
  { value: "source-anomaly", label: "Source Anomalies" },
  { value: "source-fetch", label: "Source Fetch" },
  { value: "source-parse", label: "Source Parse" },
  { value: "recompute-latest", label: "Recompute Latest" },
  { value: "poll_sources", label: "Poll Sources" },
  { value: "cask_index_sync", label: "Cask Index Sync" },
  { value: "enrich_discovered_apps", label: "Enrich Discoveries" },
] as const;

export type FailureJobTypeFilter = (typeof failureJobTypeOptions)[number]["value"];

export function getInstallTrustReasonCopy(reason: string): SecuritySignalCopy {
  return installTrustReasonCopy[reason] ?? { ...unknownSignal, label: reason };
}

export function getSourceAnomalyKind(jobKey: string | null | undefined): string | null {
  const kind = jobKey?.split(":", 1)[0];
  return kind && sourceAnomalyCopy[kind] ? kind : null;
}

export function getSourceAnomalyCopy(jobKey: string | null | undefined): SecuritySignalCopy {
  const kind = getSourceAnomalyKind(jobKey);
  return kind ? sourceAnomalyCopy[kind]! : unknownSignal;
}

export function getFetchFailureReasonCopy(reason: string): SecuritySignalCopy {
  return fetchFailureReasonCopy[reason] ?? { ...unknownSignal, label: reason };
}

export function getJobFailureTypeLabel(jobType: string, jobKey?: string | null): string {
  if (jobType === "source-anomaly") return getSourceAnomalyCopy(jobKey).label;
  return failureJobTypeLabels[jobType] ?? jobType;
}

export function canRetryJobFailure(jobType: string): boolean {
  return (
    jobType === "source-fetch" ||
    jobType === "source-parse" ||
    jobType === "recompute-latest" ||
    jobType === "poll_sources" ||
    jobType === "cask_index_sync" ||
    jobType === "enrich_discovered_apps"
  );
}

export function artifactTrustReasons(artifactType: string, sha256: string | null): string[] {
  if ((artifactType === "zip" || artifactType === "dmg" || artifactType === "pkg") && !sha256) {
    return ["missing_sha256"];
  }
  return [];
}
