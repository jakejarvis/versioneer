import { describe, expect, it } from "vite-plus/test";

import { clientPreflightResponseSchema } from "../preflight";

describe("clientPreflightResponseSchema", () => {
  it("parses a valid response with bundle IDs", () => {
    const result = clientPreflightResponseSchema.parse({
      dismissedBundleIds: ["com.example.foo", "com.example.bar"],
    });
    expect(result.dismissedBundleIds).toEqual(["com.example.foo", "com.example.bar"]);
  });

  it("parses an empty array", () => {
    const result = clientPreflightResponseSchema.parse({ dismissedBundleIds: [] });
    expect(result.dismissedBundleIds).toEqual([]);
  });

  it("rejects missing dismissedBundleIds", () => {
    expect(clientPreflightResponseSchema.safeParse({}).success).toBe(false);
  });

  it("rejects non-string array elements", () => {
    expect(clientPreflightResponseSchema.safeParse({ dismissedBundleIds: [123] }).success).toBe(
      false,
    );
  });
});
