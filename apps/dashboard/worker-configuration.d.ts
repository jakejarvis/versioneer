declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    ASSETS_BUCKET: R2Bucket;
    ASSETS_BASE_URL: string;
    CONFIG_KV: KVNamespace;
    SOURCE_FETCH_QUEUE: Queue;
    SOURCE_PARSE_QUEUE: Queue;
    ARTIFACT_VERIFY_QUEUE: Queue;
    RECOMPUTE_LATEST_QUEUE: Queue;
    GITHUB_TOKEN?: string;
    GITHUB_OAUTH_CLIENT_ID: string;
    GITHUB_OAUTH_CLIENT_SECRET: string;
    BETTER_AUTH_SECRET: string;
    ALLOWED_ADMIN_EMAILS: string;
  }
}

interface Env extends Cloudflare.Env {}
