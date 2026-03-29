export type {
  InstalledApp,
  InventoryCheckRequest,
  InventoryCheckResponse,
  AppDecision,
  InstallPrepareRequest,
  InstallPrepareResponse,
  InstallExecutionStatusRequest,
  InstallExecutionStatusResponse,
  InstallVerificationSummary,
  InstallExecutionRoute,
  InstallExecutionStatus,
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

export interface RecomputeLatestRequest {
  appId: string;
  channel?: string;
}

export interface ReleasePinRequest {
  releaseId: string;
  channel?: string;
}

export interface AppInfo {
  id: string;
  slug: string;
  canonicalName: string;
  vendorName: string | null;
  homepageUrl: string | null;
  defaultReleaseNotesUrl: string | null;
  status: "draft" | "public" | "merged" | "deprecated" | "unlisted";
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
  releaseNotesUrl: string | null;
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
