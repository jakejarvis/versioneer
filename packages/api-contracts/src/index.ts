export type {
  InstalledApp,
  InventoryCheckRequest,
  InventoryCheckResponse,
  AppDecision,
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
