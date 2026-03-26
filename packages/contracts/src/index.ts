export type {
  InstalledApp,
  InventoryCheckRequest,
  InventoryCheckResponse,
  AppDecision,
  InstallPrepareRequest,
  InstallPrepareResponse,
  InstallExecutionStatusUpdate,
} from "@versioneer/validation";

// Internal API types

export interface SourceFetchRequest {
  sourceId: string;
  reason: string;
  force?: boolean;
}

export interface SourceParseRequest {
  sourceFetchId: string;
}

export interface ArtifactVerifyRequest {
  artifactId: string;
}

export interface RecomputeLatestRequest {
  appId: string;
  channel?: "stable" | "beta" | "nightly";
}

export interface OverrideCreateRequest {
  overrideType: string;
  targetType: string;
  targetId: string;
  payloadJson: string;
  reason?: string;
  createdBy?: string;
}

export interface ReviewQueueItem {
  id: string;
  reviewType: string;
  relatedId: string | null;
  payloadJson: string | null;
  priority: number;
  status: string;
  createdAt: string;
  resolvedAt: string | null;
}

export interface AppInfo {
  id: string;
  slug: string;
  canonicalName: string;
  vendorName: string | null;
  homepageUrl: string | null;
  status: string;
}

export interface ReleaseInfo {
  id: string;
  appId: string;
  versionRaw: string;
  versionNormalized: string;
  buildNumber: string | null;
  channel: string;
  releasedAt: string | null;
  isPrerelease: boolean;
  status: string;
}

// Explanation types

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

export interface ArtifactSelectionExplanation {
  primaryArtifactId: string | null;
  artifactType: string | null;
  reason: string;
  signatureStatus: string | null;
  notarizationStatus: string | null;
  candidateCount: number;
}

// Scorecard types

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
