import { deleteInventoryMatchSnapshot } from "@versioneer/core/cache";

export async function invalidateInventoryMatchSnapshot(env: Pick<Env, "CACHE_KV">) {
  try {
    await deleteInventoryMatchSnapshot(env.CACHE_KV);
  } catch {
    // Cache invalidation is best-effort; short KV TTL keeps stale snapshots bounded.
  }
}
