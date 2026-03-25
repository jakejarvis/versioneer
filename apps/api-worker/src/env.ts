import type { AuthVariables } from "./auth/types";

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
  CF_ACCESS_TEAM_DOMAIN: string;
  CF_ACCESS_AUD: string;
  ADMIN_ORIGIN: string;
}

export type AppEnv = { Bindings: Env; Variables: AuthVariables };
