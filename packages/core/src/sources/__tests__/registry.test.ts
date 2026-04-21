import { describe, expect, it } from "vitest";

import { getDescriptor, normalizeBaseUrl } from "../registry";

describe("getDescriptor", () => {
  it("returns a descriptor for every source type", () => {
    const types = [
      "sparkle",
      "github_releases",
      "electron_generic",
      "homebrew_cask",
      "mac_app_store",
      "manual",
      "web_page",
      "regex",
      "json",
      "xml",
    ] as const;

    for (const type of types) {
      const d = getDescriptor(type);
      expect(d).toBeDefined();
      expect(typeof d.resolveUrl).toBe("function");
      expect(typeof d.extractIdentifier).toBe("function");
      expect(typeof d.buildFetchUrls).toBe("function");
      expect(typeof d.fetchHeaders).toBe("function");
      expect(typeof d.resolveArtifactBase).toBe("function");
      expect(typeof d.derivedAlias).toBe("function");
    }
  });
});

describe("sparkle descriptor", () => {
  const d = getDescriptor("sparkle");

  it("passes through URL", () => {
    expect(d.resolveUrl("https://example.com/appcast.xml")).toBe("https://example.com/appcast.xml");
  });

  it("extracts identifier as passthrough", () => {
    expect(d.extractIdentifier("https://example.com/appcast.xml")).toBe(
      "https://example.com/appcast.xml",
    );
  });

  it("derives sparkle_feed alias", () => {
    expect(d.derivedAlias("https://example.com/appcast.xml")).toEqual({
      aliasType: "sparkle_feed",
      value: "https://example.com/appcast.xml",
    });
  });

  it("does not skip fetch", () => {
    expect(d.skipsFetch).toBe(false);
  });
});

describe("github_releases descriptor", () => {
  const d = getDescriptor("github_releases");

  it("resolves owner/repo shorthand to API URL", () => {
    expect(d.resolveUrl("owner/repo")).toBe("https://api.github.com/repos/owner/repo/releases");
  });

  it("resolves full GitHub URL to API URL", () => {
    expect(d.resolveUrl("https://github.com/owner/repo")).toBe(
      "https://api.github.com/repos/owner/repo/releases",
    );
  });

  it("resolves GitHub releases page URL to API URL", () => {
    expect(d.resolveUrl("https://github.com/owner/repo/releases")).toBe(
      "https://api.github.com/repos/owner/repo/releases",
    );
  });

  it("returns null for invalid input", () => {
    expect(d.resolveUrl("not-a-valid-input")).toBeNull();
  });

  it("extracts owner/repo from API URL", () => {
    expect(d.extractIdentifier("https://api.github.com/repos/owner/repo/releases")).toBe(
      "owner/repo",
    );
  });

  it("includes GitHub API headers with token", () => {
    const headers = d.fetchHeaders({ githubToken: "ghp_test123" });
    expect(headers["Authorization"]).toBe("token ghp_test123");
    expect(headers["Accept"]).toContain("github");
  });

  it("includes GitHub API headers without token", () => {
    const headers = d.fetchHeaders({});
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["Accept"]).toContain("github");
  });

  it("derives github_repo alias from API URL", () => {
    expect(d.derivedAlias("https://api.github.com/repos/owner/repo/releases")).toEqual({
      aliasType: "github_repo",
      value: "https://github.com/owner/repo",
    });
  });
});

describe("electron_generic descriptor", () => {
  const d = getDescriptor("electron_generic");

  it("canonicalizes GitHub URL to /releases form", () => {
    expect(d.resolveUrl("https://github.com/owner/repo")).toBe(
      "https://github.com/owner/repo/releases",
    );
  });

  it("passes through generic URLs", () => {
    expect(d.resolveUrl("https://example.com/update")).toBe("https://example.com/update");
  });

  it("builds feed candidates for GitHub URLs", () => {
    expect(d.buildFetchUrls("https://github.com/owner/repo/releases")).toEqual([
      "https://github.com/owner/repo/releases/latest/download/latest-mac.yml",
      "https://github.com/owner/repo/releases/latest/download/latest.yml",
    ]);
  });

  it("builds feed candidates for generic URLs", () => {
    expect(d.buildFetchUrls("https://example.com/update")).toEqual([
      "https://example.com/update/latest-mac.yml",
      "https://example.com/update/latest.yml",
    ]);
  });

  it("resolves artifact base for GitHub URLs", () => {
    expect(d.resolveArtifactBase("https://github.com/owner/repo/releases")).toBe(
      "https://github.com/owner/repo/releases/latest/download",
    );
  });

  it("resolves artifact base for generic URLs", () => {
    expect(d.resolveArtifactBase("https://example.com/update")).toBe("https://example.com/update");
  });

  it("derives electron_update_url alias", () => {
    expect(d.derivedAlias("https://github.com/owner/repo/releases")).toEqual({
      aliasType: "electron_update_url",
      value: "https://github.com/owner/repo/releases",
    });
  });
});

describe("homebrew_cask descriptor", () => {
  const d = getDescriptor("homebrew_cask");

  it("resolves token to brew API URL", () => {
    expect(d.resolveUrl("firefox")).toBe("https://formulae.brew.sh/api/cask/firefox.json");
  });

  it("extracts token from brew API URL", () => {
    expect(d.extractIdentifier("https://formulae.brew.sh/api/cask/firefox.json")).toBe("firefox");
  });

  it("has no derived alias", () => {
    expect(d.derivedAlias("https://formulae.brew.sh/api/cask/firefox.json")).toBeNull();
  });
});

describe("mac_app_store descriptor", () => {
  const d = getDescriptor("mac_app_store");

  it("resolves bundleId to iTunes URL", () => {
    expect(d.resolveUrl("com.example.app")).toBe(
      "https://itunes.apple.com/lookup?bundleId=com.example.app&country=us",
    );
  });

  it("extracts bundleId from iTunes URL", () => {
    expect(
      d.extractIdentifier("https://itunes.apple.com/lookup?bundleId=com.example.app&country=us"),
    ).toBe("com.example.app");
  });

  it("has no derived alias", () => {
    expect(d.derivedAlias("https://itunes.apple.com/lookup?bundleId=com.example.app")).toBeNull();
  });
});

describe("manual descriptor", () => {
  const d = getDescriptor("manual");

  it("resolveUrl returns null", () => {
    expect(d.resolveUrl("anything")).toBeNull();
  });

  it("skips fetch", () => {
    expect(d.skipsFetch).toBe(true);
  });

  it("buildFetchUrls returns empty array", () => {
    expect(d.buildFetchUrls("anything")).toEqual([]);
  });

  it("has no derived alias", () => {
    expect(d.derivedAlias("anything")).toBeNull();
  });
});

describe("default descriptor (web_page, regex, json, xml)", () => {
  for (const type of ["web_page", "regex", "json", "xml"] as const) {
    describe(`${type} descriptor`, () => {
      const d = getDescriptor(type);

      it("passes through URL", () => {
        expect(d.resolveUrl("https://example.com/page")).toBe("https://example.com/page");
      });

      it("passes through identifier extraction", () => {
        expect(d.extractIdentifier("https://example.com/page")).toBe("https://example.com/page");
      });

      it("builds single-element fetch URL list", () => {
        expect(d.buildFetchUrls("https://example.com/page")).toEqual(["https://example.com/page"]);
      });

      it("has no derived alias", () => {
        expect(d.derivedAlias("https://example.com/page")).toBeNull();
      });

      it("does not skip fetch", () => {
        expect(d.skipsFetch).toBe(false);
      });
    });
  }
});

describe("normalizeBaseUrl", () => {
  it("normalizes a GitHub releases URL through round-trip", () => {
    expect(
      normalizeBaseUrl("github_releases", "https://api.github.com/repos/owner/repo/releases"),
    ).toBe("https://api.github.com/repos/owner/repo/releases");
  });

  it("normalizes a homebrew cask URL through round-trip", () => {
    expect(
      normalizeBaseUrl("homebrew_cask", "https://formulae.brew.sh/api/cask/firefox.json"),
    ).toBe("https://formulae.brew.sh/api/cask/firefox.json");
  });

  it("normalizes a generic URL as passthrough", () => {
    expect(normalizeBaseUrl("web_page", "https://example.com/page")).toBe(
      "https://example.com/page",
    );
  });

  it("returns baseUrl for manual type", () => {
    expect(normalizeBaseUrl("manual", "anything")).toBe("anything");
  });
});
