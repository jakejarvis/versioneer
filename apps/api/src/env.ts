export interface Env {
  DB: D1Database;
  RAW_BUCKET: R2Bucket;
  ASSETS_BUCKET: R2Bucket;
  ASSETS_BASE_URL: string;
  CACHE_KV: KVNamespace;
  CONFIG_KV: KVNamespace;
  SOURCE_FETCH_QUEUE: Queue;
  SOURCE_PARSE_QUEUE: Queue;
  ARTIFACT_VERIFY_QUEUE: Queue;
  RECOMPUTE_LATEST_QUEUE: Queue;
  CASK_INDEX_SYNC_QUEUE: Queue;
  ENVIRONMENT: string;
  GITHUB_TOKEN?: string;
}
