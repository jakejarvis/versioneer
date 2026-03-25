export interface Env {
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
  CACHE_KV: KVNamespace;
  CONFIG_KV: KVNamespace;
  SOURCE_FETCH_QUEUE: Queue;
  SOURCE_PARSE_QUEUE: Queue;
  ARTIFACT_VERIFY_QUEUE: Queue;
  RECOMPUTE_LATEST_QUEUE: Queue;
  ENVIRONMENT: string;
}

export interface SourceFetchJob {
  sourceId: string;
  reason: string;
  force?: boolean;
}

export interface SourceParseJob {
  sourceFetchId: string;
}

export interface ArtifactVerifyJob {
  artifactId: string;
}

export interface RecomputeLatestJob {
  appId: string;
  channel?: "stable" | "beta" | "nightly";
}
