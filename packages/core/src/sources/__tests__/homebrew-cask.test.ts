import { describe, expect, it } from "vitest";

import { homebrewCaskDescriptor } from "../homebrew-cask";

describe("homebrewCaskDescriptor", () => {
  describe("resolveUrl", () => {
    it("converts cask token to API URL", () => {
      expect(homebrewCaskDescriptor.resolveUrl("iterm2")).toBe(
        "https://formulae.brew.sh/api/cask/iterm2.json",
      );
    });

    it("encodes special characters in cask token", () => {
      expect(homebrewCaskDescriptor.resolveUrl("my cask")).toBe(
        "https://formulae.brew.sh/api/cask/my%20cask.json",
      );
    });
  });

  describe("extractIdentifier", () => {
    it("extracts cask token from API URL", () => {
      expect(
        homebrewCaskDescriptor.extractIdentifier("https://formulae.brew.sh/api/cask/iterm2.json"),
      ).toBe("iterm2");
    });

    it("returns input when no match", () => {
      expect(homebrewCaskDescriptor.extractIdentifier("https://example.com")).toBe(
        "https://example.com",
      );
    });
  });

  describe("round-trip", () => {
    it("resolveUrl then extractIdentifier returns original identifier", () => {
      const token = "visual-studio-code";
      const url = homebrewCaskDescriptor.resolveUrl(token);
      expect(homebrewCaskDescriptor.extractIdentifier(url!)).toBe(token);
    });
  });
});
