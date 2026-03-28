export interface Env {
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
  CACHE_KV: KVNamespace;
  CONFIG_KV: KVNamespace;
  SOURCE_FETCH_QUEUE: Queue;
  SOURCE_PARSE_QUEUE: Queue;
  RECOMPUTE_LATEST_QUEUE: Queue;
  CASK_INDEX_SYNC_QUEUE: Queue;
  ENVIRONMENT: string;
  GITHUB_TOKEN?: string;
}

/**
 * Builds standard headers for GitHub API requests.
 * Uses token authentication when available (5,000 req/hr),
 * falls back to unauthenticated (60 req/hr).
 */
export function githubApiHeaders(token?: string): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "Versioneer/1.0 (https://versioneer.app)",
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
}

export interface SourceParseJob {
  sourceFetchId: string;
}

export interface RecomputeLatestJob {
  appId: string;
  channel?: string;
}
