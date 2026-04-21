import { load } from "cheerio";
import { describe, expect, it } from "vite-plus/test";

import { discoverHomepageSourceCandidates } from "../scrape-html";

const SAMPLE_HOMEPAGE = `
  <html>
    <head>
      <link rel="alternate" type="application/rss+xml" href="/feeds/releases.xml" />
      <link rel="alternate" type="application/json" href="/updates/releases.json" />
    </head>
    <body>
      <a href="/sparkle/appcast.xml">Sparkle</a>
      <a href="/downloads/latest-mac.yml">Electron</a>
      <a href="https://github.com/example/app/releases">GitHub</a>
      <a href="https://cdn.example.com/releases.xml">Ignore cross-origin feed</a>
    </body>
  </html>
`;

describe("discoverHomepageSourceCandidates", () => {
  it("extracts authoritative and reference candidates from homepage markup", () => {
    const doc = load(SAMPLE_HOMEPAGE);
    const result = discoverHomepageSourceCandidates(doc, "https://example.com");

    expect(result).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          sourceType: "sparkle",
          url: "https://example.com/sparkle/appcast.xml",
          role: "authority",
        }),
        expect.objectContaining({
          sourceType: "electron_generic",
          url: "https://example.com/downloads/latest-mac.yml",
          role: "authority",
        }),
        expect.objectContaining({
          sourceType: "github_releases",
          url: "https://github.com/example/app",
          role: "authority",
        }),
        expect.objectContaining({
          sourceType: "xml",
          url: "https://example.com/feeds/releases.xml",
          role: "corroborating",
        }),
        expect.objectContaining({
          sourceType: "json",
          url: "https://example.com/updates/releases.json",
          role: "corroborating",
        }),
      ]),
    );
  });

  it("ignores cross-origin feed links other than explicit GitHub repos", () => {
    const doc = load('<a href="https://cdn.example.com/releases.xml">feed</a>');
    const result = discoverHomepageSourceCandidates(doc, "https://example.com");
    expect(result).toEqual([]);
  });
});
