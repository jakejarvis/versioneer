import type { CacheKV } from "../cache/types";

/**
 * Creates an in-memory CacheKV implementation for testing.
 */
export function createMockKV(): CacheKV & { store: Map<string, string> } {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string) {
      return store.get(key) ?? null;
    },
    async put(key: string, value: string, _options?: { expirationTtl?: number }) {
      store.set(key, value);
    },
    async delete(key: string) {
      store.delete(key);
    },
  };
}
