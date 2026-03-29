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
  openFailures: number;
  recentReleases: number;
  verifiedApps: number;
  pendingFeedback: number;
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
  isVerified: boolean;
  verifiedAt: string | null;
  installStrategyOverride: string | null;
  defaultReleaseNotesUrl: string | null;
  iconR2Key: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AppSummary {
  id: string;
  slug: string;
  canonicalName: string;
  vendorName: string | null;
  iconR2Key: string | null;
  status: App["status"];
}

export interface SourceSummary {
  id: string;
  sourceType: "sparkle" | "github_releases" | "manual" | "homebrew_cask" | "mac_app_store";
  label: string | null;
  parserKey: string;
  channel: string | null;
  status: "active" | "paused" | "disabled" | "error";
  app: AppSummary | null;
}

export interface ReleaseSummary {
  id: string;
  versionRaw: string;
  channel: string;
  status: "active" | "superseded" | "draft";
  isPrerelease: boolean;
  releasedAt: string | null;
  app: AppSummary | null;
}

export interface LinkedEntityRef {
  kind: "app" | "source" | "release" | "job_failure" | "feedback";
  id: string;
  label: string;
  description: string | null;
  iconR2Key: string | null;
}

export interface AppListItem extends App {
  sourceCount: number;
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
    | "github_repo"
    | "mas_app_id"
    | "homebrew_cask";
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
  sourceType: "sparkle" | "github_releases" | "manual" | "homebrew_cask" | "mac_app_store";
  label: string | null;
  baseUrl: string | null;
  configJson: string | null;
  parserKey: string;
  channel: string | null;
  pollIntervalMinutes: number;
  status: "active" | "paused" | "disabled" | "error";
  lastSuccessAt: string | null;
  lastFailureAt: string | null;
  lastFetchedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SourceListItem extends Source {
  app: AppSummary | null;
}

export interface SourceDetail extends Source {
  app: AppSummary | null;
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
  channel: string;
  releasedAt: string | null;
  isPrerelease: boolean;
  sourceConfidence: number | null;
  status: "active" | "superseded" | "draft";
  releaseNotesHtml: string | null;
  releaseNotesUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseListItem extends Release {
  app: AppSummary | null;
  isLatestForChannel: boolean;
  isPinnedLatest: boolean;
}

export interface ReleaseDetail extends Release {
  app: AppSummary | null;
  isLatestForChannel: boolean;
  isPinnedLatest: boolean;
}

export interface Artifact {
  id: string;
  releaseId: string;
  artifactType: "zip" | "dmg" | "pkg" | "appcast_enclosure" | "mac_app_store" | "other";
  url: string;
  urlHash: string | null;
  sha256: string | null;
  sizeBytes: number | null;
  architecture: string | null;
  minOsVersion: string | null;
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
  channel: string;
  releaseId: string;
  artifactId: string | null;
  versionNormalized: string;
  versionRaw: string;
  releasedAt: string | null;
  pinnedReleaseId: string | null;
  pinnedAt: string | null;
  pinnedBy: string | null;
  installStrategy: string | null;
  updatedAt: string;
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

export interface JobFailureListItem extends JobFailure {
  relatedRef: LinkedEntityRef | null;
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

export interface AuditLogListItem extends AuditLogEntry {
  targetRef: LinkedEntityRef | null;
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

export interface FeedbackItem {
  id: string;
  feedbackType: "wrong_match" | "wrong_version" | "app_request" | "general";
  targetAppId: string | null;
  bundleId: string | null;
  appName: string | null;
  payloadJson: string | null;
  status: "new" | "triaged" | "resolved" | "dismissed";
  resolvedAt: string | null;
  createdAt: string;
}

export interface FeedbackListItem extends FeedbackItem {
  targetApp: AppSummary | null;
}
