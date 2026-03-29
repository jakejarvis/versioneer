import { describe, expect, it } from "vitest";

import { parseGitHubRepoUrl, toGitHubApiReleasesUrl } from "../github-url";

describe("parseGitHubRepoUrl", () => {
  it("parses owner/repo from a basic GitHub URL", () => {
    expect(parseGitHubRepoUrl("https://github.com/nicehash/NiceHashQuickMiner")).toEqual({
      owner: "nicehash",
      repo: "NiceHashQuickMiner",
    });
  });

  it("parses owner/repo from a /releases URL", () => {
    expect(parseGitHubRepoUrl("https://github.com/nicehash/NiceHashQuickMiner/releases")).toEqual({
      owner: "nicehash",
      repo: "NiceHashQuickMiner",
    });
  });

  it("parses owner/repo from a /releases/latest URL", () => {
    expect(
      parseGitHubRepoUrl("https://github.com/obsidianmd/obsidian-releases/releases/latest"),
    ).toEqual({
      owner: "obsidianmd",
      repo: "obsidian-releases",
    });
  });

  it("handles www.github.com", () => {
    expect(parseGitHubRepoUrl("https://www.github.com/owner/repo")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("handles trailing slash", () => {
    expect(parseGitHubRepoUrl("https://github.com/owner/repo/")).toEqual({
      owner: "owner",
      repo: "repo",
    });
  });

  it("returns null for non-GitHub URLs", () => {
    expect(parseGitHubRepoUrl("https://gitlab.com/owner/repo")).toBeNull();
    expect(parseGitHubRepoUrl("https://notgithub.com/owner/repo")).toBeNull();
  });

  it("returns null when path has only one segment", () => {
    expect(parseGitHubRepoUrl("https://github.com/onlyone")).toBeNull();
  });

  it("returns null for root GitHub URL", () => {
    expect(parseGitHubRepoUrl("https://github.com/")).toBeNull();
    expect(parseGitHubRepoUrl("https://github.com")).toBeNull();
  });

  it("returns null for non-URL strings", () => {
    expect(parseGitHubRepoUrl("not a url")).toBeNull();
    expect(parseGitHubRepoUrl("")).toBeNull();
  });
});

describe("toGitHubApiReleasesUrl", () => {
  it("converts a GitHub HTML URL to the API releases URL", () => {
    expect(toGitHubApiReleasesUrl("https://github.com/nicehash/NiceHashQuickMiner/releases")).toBe(
      "https://api.github.com/repos/nicehash/NiceHashQuickMiner/releases",
    );
  });

  it("converts a bare repo URL", () => {
    expect(toGitHubApiReleasesUrl("https://github.com/owner/repo")).toBe(
      "https://api.github.com/repos/owner/repo/releases",
    );
  });

  it("converts a /releases/latest URL", () => {
    expect(toGitHubApiReleasesUrl("https://github.com/owner/repo/releases/latest")).toBe(
      "https://api.github.com/repos/owner/repo/releases",
    );
  });

  it("returns null for non-GitHub URLs", () => {
    expect(toGitHubApiReleasesUrl("https://example.com/appcast.xml")).toBeNull();
  });

  it("returns null for invalid strings", () => {
    expect(toGitHubApiReleasesUrl("not a url")).toBeNull();
  });
});
