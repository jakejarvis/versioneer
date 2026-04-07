import { describe, expect, it } from "vitest";

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
    expect(() => clientPreflightResponseSchema.parse({})).toThrow();
  });

  it("rejects non-string array elements", () => {
    expect(() => clientPreflightResponseSchema.parse({ dismissedBundleIds: [123] })).toThrow();
  });
});
