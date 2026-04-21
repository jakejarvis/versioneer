import { describe, expect, it } from "vite-plus/test";

import { sparkleDescriptor } from "../sparkle";

describe("sparkleDescriptor", () => {
  describe("derivedAlias", () => {
    it("returns sparkle_feed alias with the feed URL as value", () => {
      const alias = sparkleDescriptor.derivedAlias("https://example.com/appcast.xml");
      expect(alias).toEqual({
        aliasType: "sparkle_feed",
        value: "https://example.com/appcast.xml",
      });
    });
  });

  describe("resolveUrl", () => {
    it("passes through the URL unchanged (inherited from defaultDescriptor)", () => {
      const url = "https://example.com/appcast.xml";
      expect(sparkleDescriptor.resolveUrl(url)).toBe(url);
    });
  });
});
