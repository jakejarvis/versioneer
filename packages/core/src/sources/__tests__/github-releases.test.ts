import { describe, expect, it } from "vite-plus/test";

import { githubReleasesDescriptor, toGitHubRepoUrl } from "../github-releases";

describe("githubReleasesDescriptor", () => {
  describe("resolveUrl", () => {
    it("converts owner/repo shorthand to API URL", () => {
      expect(githubReleasesDescriptor.resolveUrl("sindresorhus/Plash")).toBe(
        "https://api.github.com/repos/sindresorhus/Plash/releases",
      );
    });

    it("converts a full GitHub URL to API URL", () => {
      expect(githubReleasesDescriptor.resolveUrl("https://github.com/owner/repo")).toBe(
        "https://api.github.com/repos/owner/repo/releases",
      );
    });

    it("converts a GitHub releases URL to API URL", () => {
      expect(githubReleasesDescriptor.resolveUrl("https://github.com/owner/repo/releases")).toBe(
        "https://api.github.com/repos/owner/repo/releases",
      );
    });

    it("returns null for non-GitHub URLs", () => {
      expect(githubReleasesDescriptor.resolveUrl("https://example.com/feed")).toBeNull();
    });
  });

  describe("extractIdentifier", () => {
    it("extracts owner/repo from API URL", () => {
      expect(
        githubReleasesDescriptor.extractIdentifier(
          "https://api.github.com/repos/sindresorhus/Plash/releases",
        ),
      ).toBe("sindresorhus/Plash");
    });

    it("returns input when no match", () => {
      expect(githubReleasesDescriptor.extractIdentifier("https://example.com")).toBe(
        "https://example.com",
      );
    });
  });

  describe("round-trip", () => {
    it("resolveUrl then extractIdentifier returns original identifier", () => {
      const identifier = "owner/repo";
      const url = githubReleasesDescriptor.resolveUrl(identifier);
      expect(githubReleasesDescriptor.extractIdentifier(url!)).toBe(identifier);
    });
  });

  describe("fetchHeaders", () => {
    it("includes Authorization header when token is provided", () => {
      const headers = githubReleasesDescriptor.fetchHeaders({
        githubToken: "ghp_test123",
      });
      expect(headers["Authorization"]).toBe("token ghp_test123");
    });

    it("omits Authorization header when no token", () => {
      const headers = githubReleasesDescriptor.fetchHeaders({});
      expect(headers["Authorization"]).toBeUndefined();
    });
  });

  describe("derivedAlias", () => {
    it("returns github_repo alias pointing to HTML URL", () => {
      const alias = githubReleasesDescriptor.derivedAlias(
        "https://api.github.com/repos/owner/repo/releases",
      );
      expect(alias).toEqual({
        aliasType: "github_repo",
        value: "https://github.com/owner/repo",
      });
    });
  });
});

describe("toGitHubRepoUrl", () => {
  it("converts API URL to HTML URL", () => {
    expect(toGitHubRepoUrl("https://api.github.com/repos/foo/bar/releases")).toBe(
      "https://github.com/foo/bar",
    );
  });

  it("returns input when no match", () => {
    expect(toGitHubRepoUrl("https://example.com")).toBe("https://example.com");
  });
});
