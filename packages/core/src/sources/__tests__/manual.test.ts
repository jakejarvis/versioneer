import { describe, expect, it } from "vitest";

import { manualDescriptor } from "../manual";

describe("manualDescriptor", () => {
  it("has skipsFetch set to true", () => {
    expect(manualDescriptor.skipsFetch).toBe(true);
  });

  it("resolveUrl returns null", () => {
    expect(manualDescriptor.resolveUrl("anything")).toBeNull();
  });

  it("buildFetchUrls returns empty array", () => {
    expect(manualDescriptor.buildFetchUrls("https://example.com")).toEqual([]);
  });
});
