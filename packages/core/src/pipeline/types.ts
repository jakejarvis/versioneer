export interface SourceFetchEnv {
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
  GITHUB_TOKEN?: string;
  resolveSourceHostAddresses?: (hostname: string) => Promise<string[]>;
}

export interface SourceParseEnv {
  DB: D1Database;
  CACHE_KV: KVNamespace;
  RAW_BUCKET: R2Bucket;
}

export interface RecomputeLatestEnv {
  DB: D1Database;
  CACHE_KV: KVNamespace;
}

export interface CaskIndexSyncEnv {
  DB: D1Database;
  CACHE_KV: KVNamespace;
  CONFIG_KV: KVNamespace;
}

export interface CaskSyncDueEnv {
  CONFIG_KV: KVNamespace;
}

export interface Env extends SourceFetchEnv, SourceParseEnv, RecomputeLatestEnv, CaskIndexSyncEnv {
  ENVIRONMENT: string;
}

export interface FetchStepResult {
  sourceFetchId: string | null;
  shouldParse: boolean;
  appId: string;
}

export interface ParseStepResult {
  appId: string;
  releaseCount: number;
}

export const VERSIONEER_USER_AGENT = "Versioneer/1.0 (https://versioneer.app)";

/**
 * Builds standard headers for GitHub API requests.
 * Uses token authentication when available (5,000 req/hr),
 * falls back to unauthenticated (60 req/hr).
 */
export function githubApiHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": VERSIONEER_USER_AGENT,
  };
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }
  return headers;
}

export interface SourceFetchJob {
  sourceId: string;
  reason: string;
  force?: boolean;
  idempotencyKey?: string;
}

export interface SourceParseJob {
  sourceFetchId: string;
}

export interface RecomputeLatestJob {
  appId: string;
  channel?: string;
}

export interface EnrichmentDrainJob {
  runId: string;
  trigger: "manual" | "scheduled";
  actorId?: string | null;
  failureJobKey?: string | null;
}
