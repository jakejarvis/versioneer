declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS_BUCKET: R2Bucket;
    ASSETS_BASE_URL: string;
    SOURCE_FETCH_QUEUE: Queue;
    SOURCE_PARSE_QUEUE: Queue;
    ARTIFACT_VERIFY_QUEUE: Queue;
    RECOMPUTE_LATEST_QUEUE: Queue;
    GITHUB_TOKEN?: string;
  }
}

interface Env extends Cloudflare.Env {}
