import type { AliasType, AppStatus } from "@versioneer/schemas/catalog";
import type { FeedbackStatus, FeedbackType } from "@versioneer/schemas/feedback";
import type {
  CronJobType,
  CronRunStatus,
  CronTrigger,
  JobFailureStatus,
} from "@versioneer/schemas/ops";
import type { ArtifactType, ReleaseStatus } from "@versioneer/schemas/releases";
import type { EvidenceType, QueueType, SuggestionStatus } from "@versioneer/schemas/review";
import type {
  FetchStatus,
  ReviewStatus,
  RunStatus,
  SourceRole,
  SourceStatus,
  SourceType,
} from "@versioneer/schemas/sources";

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
  publicApps: number;
  pendingFeedback: number;
  pendingDiscoveredApps: number;
  pendingCatalogSuggestions: number;
}

export interface DashboardOverviewSection {
  pendingCatalogSuggestions: number;
  pendingDiscoveredApps: number;
  pendingFeedback: number;
  openFailures: number;
}

export interface DashboardSourceHealthSection {
  activeSources: number;
  errorSources: number;
  staleSources: number;
}

export interface DashboardCatalogContextSection {
  publicApps: number;
  totalApps: number;
  recentReleases: number;
}

export interface DashboardEnrichmentHealthSection {
  pendingEnrichment: number;
  enriched: number;
  failed: number;
  inProgress: number;
}

export interface HomepageDiscoveryItem {
  id: string;
  appName: string;
  bundleId: string | null;
  masAppId: string | null;
  sightingCount: number;
  lastSeenAt: string;
  enrichmentStatus: string;
  sourceValidationStatus: string;
  confidenceScore: number | null;
  enrichedLatestVersion: string | null;
  enrichedVendorName: string | null;
  iconR2Key: string | null;
  sparkleFeedUrl: string | null;
  electronUpdateUrl: string | null;
  electronUpdateProvider: string | null;
  minMacOSVersion: string | null;
  homebrewCaskToken: string | null;
  homebrewCaskVersion: string | null;
}

export interface HomepageRunItem {
  id: string;
  jobType: CronJobType;
  trigger: CronTrigger;
  status: CronRunStatus;
  actorId: string | null;
  itemsQueued: number | null;
  itemsTotal: number | null;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
}

export interface AtRiskSourceItem extends SourceListItem {
  risk: "error" | "overdue";
  overdueMinutes: number | null;
}

export interface DashboardHomepageData {
  overview: {
    needsAttention: DashboardOverviewSection;
    sourceHealth: DashboardSourceHealthSection;
    catalogContext: DashboardCatalogContextSection;
    enrichmentHealth: DashboardEnrichmentHealthSection;
  };
  pendingSuggestions: CatalogSuggestion[];
  pendingDiscoveries: HomepageDiscoveryItem[];
  newFeedback: FeedbackListItem[];
  openFailures: JobFailureListItem[];
  atRiskSources: AtRiskSourceItem[];
  recentRuns: HomepageRunItem[];
  recentReleases: ReleaseListItem[];
}

export interface CatalogSuggestion {
  id: string;
  queueType: QueueType;
  status: SuggestionStatus;
  appId: string | null;
  sourceId: string | null;
  bundleKey: string | null;
  dedupeKey: string;
  title: string;
  canonicalSnapshotJson: string | null;
  proposedChangeJson: string;
  evidenceSummaryJson: string | null;
  evidenceCount: number;
  firstSeenAt: string;
  lastSeenAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
  app: AppSummary | null;
  source: SourceSummary | null;
}

export interface SuggestionEvidence {
  id: string;
  suggestionId: string;
  appId: string | null;
  sourceId: string | null;
  evidenceType: EvidenceType;
  fingerprint: string;
  payloadJson: string;
  observedAt: string;
  createdAt: string;
}

export interface CatalogSuggestionDetail extends CatalogSuggestion {
  evidence: SuggestionEvidence[];
}

export interface App {
  id: string;
  slug: string;
  canonicalName: string;
  vendorName: string | null;
  homepageUrl: string | null;
  status: AppStatus;
  mergedIntoAppId: string | null;
  notes: string | null;
  defaultReleaseNotesUrl: string | null;
  iconR2Key: string | null;
  publicTrackedAt: string | null;
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
  sourceType: SourceType;
  label: string | null;
  parserKey: string;
  channel: string | null;
  reviewStatus: ReviewStatus;
  role: SourceRole | null;
  status: SourceStatus;
  app: AppSummary | null;
}

export interface ReleaseSummary {
  id: string;
  versionRaw: string;
  channel: string;
  status: ReleaseStatus;
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

export interface AppSourceHealth {
  total: number;
  active: number;
  error: number;
  stale: number;
  disabled: number;
  latestFetchAt: string | null;
  latestSuccessAt: string | null;
  latestFailureAt: string | null;
  status: "fresh" | "attention" | "no_sources" | "unknown";
}

export interface AppDetail extends App {
  sourceCount: number;
  latestReleases: AppLatestRelease[];
  sourceHealth: AppSourceHealth;
}

export interface AppAlias {
  id: string;
  appId: string;
  aliasType: AliasType;
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
  sourceType: SourceType;
  label: string | null;
  baseUrl: string | null;
  configJson: string | null;
  parserKey: string;
  channel: string | null;
  pollIntervalMinutes: number;
  reviewStatus: ReviewStatus;
  role: SourceRole | null;
  ordinal: number;
  status: SourceStatus;
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
  fetchStatus: FetchStatus;
  httpStatus: number | null;
  etag: string | null;
  lastModified: string | null;
  contentType: string | null;
  contentLength: number | null;
  contentHash: string | null;
  r2Key: string | null;
  errorMessage: string | null;
  fetchUrl: string | null;
  fetchHostname: string | null;
  fetchScheme: string | null;
  failureReason: string | null;
  fetchedAt: string;
}

export interface ParserRun {
  id: string;
  sourceFetchId: string;
  parserKey: string;
  parserVersion: string | null;
  runStatus: RunStatus;
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
  status: ReleaseStatus;
  releaseNotesMarkdown: string | null;
  releaseNotesHtml: string | null;
  releaseNotesUrl: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReleaseListItem extends Release {
  app: AppSummary | null;
  isLatestForChannel: boolean;
  isPinnedLatest: boolean;
  latestTargetArchitectures: string[];
  pinnedTargetArchitectures: string[];
}

export interface ReleaseLatestTarget {
  id: string;
  targetArchitecture: string;
  channel: string;
  artifactId: string | null;
  installStrategy: string | null;
  pinnedReleaseId: string | null;
  pinnedAt: string | null;
  pinnedBy: string | null;
  trustWarnings: string[];
}

export interface ReleaseDetail extends Release {
  app: AppSummary | null;
  isLatestForChannel: boolean;
  isPinnedLatest: boolean;
  latestInstallStrategy: string | null;
  latestArtifactId: string | null;
  latestTargets: ReleaseLatestTarget[];
  trustWarnings: string[];
}

export interface Artifact {
  id: string;
  releaseId: string;
  artifactType: ArtifactType;
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
  targetArchitecture: string;
  releaseId: string;
  artifactId: string | null;
  versionNormalized: string;
  versionRaw: string;
  releasedAt: string | null;
  pinnedReleaseId: string | null;
  pinnedAt: string | null;
  pinnedBy: string | null;
  installStrategy: string | null;
  trustWarnings: string[];
  updatedAt: string;
}

export interface JobFailure {
  id: string;
  jobType: string;
  jobKey: string | null;
  relatedId: string | null;
  errorMessage: string | null;
  retryCount: number;
  status: JobFailureStatus;
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
  feedbackType: FeedbackType;
  targetAppId: string | null;
  bundleId: string | null;
  appName: string | null;
  payloadJson: string | null;
  status: FeedbackStatus;
  resolvedAt: string | null;
  createdAt: string;
}

export interface FeedbackListItem extends FeedbackItem {
  targetApp: AppSummary | null;
}
