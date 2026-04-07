import { describe, expect, it, vi } from "vitest";

import { createMockKV } from "../../__tests__/test-utils";
import { refreshDismissedBundleIdsCache } from "../dismissed";

function createMockDb(rows: Array<{ bundleId: string | null }>) {
  return {
    select: vi.fn<() => unknown>().mockReturnValue({
      from: vi.fn<() => unknown>().mockReturnValue({
        where: vi.fn<() => unknown>().mockReturnValue({
          all: vi.fn<() => Promise<typeof rows>>().mockResolvedValue(rows),
        }),
      }),
    }),
  } as never;
}

describe("refreshDismissedBundleIdsCache", () => {
  it("returns dismissed bundle IDs and writes to KV", async () => {
    const kv = createMockKV();
    const db = createMockDb([
      { bundleId: "com.example.foo" },
      { bundleId: "com.example.bar" },
      { bundleId: "com.example.baz" },
    ]);

    const result = await refreshDismissedBundleIdsCache(db, kv);

    expect(result).toEqual(["com.example.foo", "com.example.bar", "com.example.baz"]);
    const cached = await kv.get("dismissed-bundle-ids");
    expect(cached).not.toBeNull();
    expect(JSON.parse(cached!)).toEqual(["com.example.foo", "com.example.bar", "com.example.baz"]);
  });

  it("deduplicates bundle IDs", async () => {
    const kv = createMockKV();
    const db = createMockDb([
      { bundleId: "com.example.dup" },
      { bundleId: "com.example.dup" },
      { bundleId: "com.example.other" },
    ]);

    const result = await refreshDismissedBundleIdsCache(db, kv);
    expect(result).toEqual(["com.example.dup", "com.example.other"]);
  });

  it("returns empty array when no dismissed apps exist", async () => {
    const kv = createMockKV();
    const db = createMockDb([]);

    const result = await refreshDismissedBundleIdsCache(db, kv);
    expect(result).toEqual([]);
    // KV should still be written (with empty array)
    const cached = await kv.get("dismissed-bundle-ids");
    expect(JSON.parse(cached!)).toEqual([]);
  });
});
