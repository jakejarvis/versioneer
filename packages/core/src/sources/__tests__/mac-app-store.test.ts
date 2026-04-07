import { describe, expect, it } from "vitest";

import { macAppStoreDescriptor } from "../mac-app-store";

describe("macAppStoreDescriptor", () => {
  describe("resolveUrl", () => {
    it("converts bundle ID to iTunes lookup URL", () => {
      expect(macAppStoreDescriptor.resolveUrl("com.apple.Safari")).toBe(
        "https://itunes.apple.com/lookup?bundleId=com.apple.Safari&country=us",
      );
    });
  });

  describe("extractIdentifier", () => {
    it("extracts bundle ID from lookup URL", () => {
      expect(
        macAppStoreDescriptor.extractIdentifier(
          "https://itunes.apple.com/lookup?bundleId=com.apple.Safari&country=us",
        ),
      ).toBe("com.apple.Safari");
    });

    it("returns input when no match", () => {
      expect(macAppStoreDescriptor.extractIdentifier("https://example.com")).toBe(
        "https://example.com",
      );
    });
  });

  describe("round-trip", () => {
    it("resolveUrl then extractIdentifier returns original identifier", () => {
      const bundleId = "com.example.app";
      const url = macAppStoreDescriptor.resolveUrl(bundleId);
      expect(macAppStoreDescriptor.extractIdentifier(url!)).toBe(bundleId);
    });
  });
});
