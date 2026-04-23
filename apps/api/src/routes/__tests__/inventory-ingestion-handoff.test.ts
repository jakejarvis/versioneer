import { describe, expect, it } from "vite-plus/test";

import { computeLookupKey } from "../inventory-ingestion-handoff";

describe("computeLookupKey", () => {
  it("normalizes trailing .app suffixes for bundleless installs", () => {
    expect(computeLookupKey("Firefox.app", null)).toBe("name:firefox");
    expect(computeLookupKey(" Firefox.app ", undefined)).toBe("name:firefox");
  });

  it("prefers bundle IDs over app names", () => {
    expect(computeLookupKey("Firefox.app", "org.mozilla.firefox")).toBe("bid:org.mozilla.firefox");
  });
});
