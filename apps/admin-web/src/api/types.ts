export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export interface DashboardStats {
  totalApps: number;
  activeSources: number;
  errorSources: number;
  pendingReviews: number;
  openFailures: number;
  recentReleases: number;
  verifiedApps: number;
  greenApps: number;
  yellowApps: number;
  redApps: number;
}

export interface App {
  id: string;
  slug: string;
  canonicalName: string;
  vendorName: string | null;
  homepageUrl: string | null;
  status: "active" | "deprecated" | "merged" | "unlisted";
  mergedIntoAppId: string | null;
  notes: string | null;
  verificationTier: "unverified" | "provisional" | "verified";
  qualityState: "green" | "yellow" | "red" | "unknown";
  qualityScore: number | null;
  lastReviewedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppAlias {
  id: string;
  appId: string;
  aliasType:
    | "bundle_id"
    | "name"
    | "team_id"
    | "sparkle_feed"
    | "homepage"
    | "download_pattern"
    | "github_repo";
  value: string;
  normalizedValue: string;
  isExact: boolean;
  priority: number;
  confidenceWeight: number;
  source: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface Source {
  id: string;
  appId: string;
  sourceType: "sparkle" | "github_releases" | "manual";
  label: string | null;
  baseUrl: string | null;
  configJson: string | null;
  parserKey: string;
  pollIntervalMinutes: number;
  status: "active" | "paused" | "disabled" | "error";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceFetch {
  id: string;
  sourceId: string;
  fetchStatus: "success" | "not_modified" | "error" | "timeout";
  httpStatus: number | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  contentLength: number | null;
  contentHash: string | null;
  r2Key: string | null;
  errorMessage: string | null;
  fetchedAt: string;
}

export interface ParserRun {
  id: string;
  sourceFetchId: string;
  parserKey: string;
  parserVersion: string | null;
  runStatus: "success" | "partial" | "error";
  observationCount: number;
  confidence: number | null;
  errorMessage: string | null;
  startedAt: string;
  finishedAt: string | null;
}

export interface Release {
  id: string;
  appId: string;
  versionRaw: string;
  versionNormalized: string;
  buildNumber: string | null;
  channel: "stable" | "beta" | "nightly";
  releasedAt: string | null;
  isPrerelease: boolean;
  sourceConfidence: number | null;
  status: "active" | "retracted" | "superseded" | "draft";
  createdAt: string;
  updatedAt: string;
}

export interface Artifact {
  id: string;
  releaseId: string;
  artifactType: "zip" | "dmg" | "pkg" | "appcast_enclosure" | "other";
  url: string;
  urlHash: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  architecture: string | null;
  minOsVersion: string | null;
  signatureStatus: "unknown" | "valid" | "invalid" | "missing";
  notarizationStatus: "unknown" | "notarized" | "not_notarized";
  expectedTeamId: string | null;
  isPrimary: boolean;
  createdAt: string;
}

export interface ReleaseObservation {
  id: string;
  parserRunId: string;
  appId: string;
  releaseId: string | null;
  observedVersionRaw: string | null;
  observedVersionNormalized: string | null;
  observedBuildNumber: string | null;
  observedChannel: string | null;
  observedPublishedAt: string | null;
  observedReleaseNotesUrl: string | null;
  observedDownloadUrl: string | null;
  confidence: number | null;
  observationJson: string | null;
  createdAt: string;
}

export interface AppLatestRelease {
  id: string;
  appId: string;
  channel: "stable" | "beta" | "nightly";
  releaseId: string;
  artifactId: string | null;
  versionNormalized: string;
  versionRaw: string;
  releasedAt: string | null;
  decisionSource: "pipeline" | "override" | "manual";
  confidence: number | null;
  decisionExplanationJson: string | null;
  updatedAt: string;
}

export interface InstallRule {
  id: string;
  appId: string;
  strategy: "sparkle" | "zip_replace" | "dmg_copy_replace" | "pkg_manual" | "manual_only";
  requiresQuit: boolean;
  requiresAdmin: boolean;
  supportsSilent: boolean;
  rollbackSupported: boolean;
  ruleConfidence: number | null;
  enabled: boolean;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReviewQueueItem {
  id: string;
  reviewType: string;
  relatedId: string | null;
  payloadJson: string | null;
  priority: number;
  status: "pending" | "in_progress" | "resolved" | "dismissed";
  createdAt: string;
  resolvedAt: string | null;
}

export interface JobFailure {
  id: string;
  jobType: string;
  jobKey: string | null;
  relatedId: string | null;
  errorMessage: string | null;
  retryCount: number;
  status: "open" | "retrying" | "resolved" | "abandoned";
  createdAt: string;
  resolvedAt: string | null;
}

export interface Override {
  id: string;
  overrideType: string;
  targetType: string;
  targetId: string;
  payloadJson: string;
  reason: string | null;
  createdBy: string | null;
  isActive: boolean;
  createdAt: string;
}

export interface AuditLogEntry {
  id: string;
  eventType: string;
  actorType: string | null;
  actorId: string | null;
  targetType: string | null;
  targetId: string | null;
  payloadJson: string | null;
  createdAt: string;
}

export interface AppScorecard {
  id: string;
  appId: string;
  sourceTypesPresent: string | null;
  latestFetchSuccessAt: string | null;
  recentFetchSuccessRate: number | null;
  recentParseSuccessRate: number | null;
  latestReleaseConfidence: number | null;
  artifactTrustStatus: string | null;
  inventoryMatchSuccessRate: number | null;
  ambiguityRate: number | null;
  activeOverrideCount: number;
  updatedAt: string;
}

export interface OnboardingChecklist {
  id: string;
  appId: string;
  hasCanonicalRecord: boolean;
  hasAliases: boolean;
  hasSource: boolean;
  parserOutputVerified: boolean;
  latestReleasePublished: boolean;
  reviewQueueClear: boolean;
  qualityScoreAcceptable: boolean;
  isComplete: boolean;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceHealthMetric {
  id: string;
  sourceId: string;
  periodStart: string;
  fetchAttempts: number;
  fetchSuccesses: number;
  fetchFailures: number;
  parseAttempts: number;
  parseSuccesses: number;
  parseFailures: number;
  reviewItemsCreated: number;
  createdAt: string;
}

export interface MatchExplanation {
  method: string;
  confidence: number;
  matchedAliasType: string | null;
  matchedAliasValue: string | null;
  candidateCount: number;
  ambiguous: boolean;
  ambiguityGap: number | null;
  topCandidates: { appId: string; appName: string; method: string; confidence: number }[];
}

export interface DecisionExplanation {
  selectedReleaseId: string;
  selectedVersion: string;
  reason: "highest_version" | "override";
  overrideId: string | null;
  candidateCount: number;
  alternatesRejected: { releaseId: string; version: string; reason: string }[];
  sourceConfidence: number | null;
}
