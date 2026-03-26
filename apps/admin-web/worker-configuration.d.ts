declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    SOURCE_FETCH_QUEUE: Queue;
    SOURCE_PARSE_QUEUE: Queue;
    ARTIFACT_VERIFY_QUEUE: Queue;
    RECOMPUTE_LATEST_QUEUE: Queue;
  }
}

interface Env extends Cloudflare.Env {}
