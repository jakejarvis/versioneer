import { describe, it, expect } from "vite-plus/test";

import { webPageParser } from "../web-page";

const SAMPLE_PAGE = `
<html>
<body>
  <h1>MyApp Downloads</h1>
  <span class="version">Version 3.2.1</span>
  <a class="download" href="https://example.com/MyApp-3.2.1.dmg">Download DMG</a>
  <a class="download" href="https://example.com/MyApp-3.2.1.zip">Download ZIP</a>
</body>
</html>
`;

const MINIMAL_PAGE = `
<html>
<body>
  <div id="release">2.0.0</div>
  <a id="dl" href="/files/app.pkg">Download</a>
</body>
</html>
`;

describe("webPageParser", () => {
  it("extracts version and download links with CSS selectors", () => {
    const result = webPageParser.parse(SAMPLE_PAGE, {
      versionSelector: ".version",
      versionPattern: "([\\d.]+)",
      downloadSelector: "a.download",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.confidence).toBe(70);
    expect(result.errors).toHaveLength(0);

    const release = result.releases[0]!;
    expect(release.versionRaw).toBe("3.2.1");
    expect(release.channel).toBe("stable");
    expect(release.isPrerelease).toBe(false);
    expect(release.artifacts).toHaveLength(2);
    expect(release.artifacts[0]!.url).toBe("https://example.com/MyApp-3.2.1.dmg");
    expect(release.artifacts[0]!.type).toBe("dmg");
    expect(release.artifacts[1]!.url).toBe("https://example.com/MyApp-3.2.1.zip");
    expect(release.artifacts[1]!.type).toBe("zip");
  });

  it("uses full text when no versionPattern is provided", () => {
    const result = webPageParser.parse(MINIMAL_PAGE, {
      versionSelector: "#release",
      downloadSelector: "#dl",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("2.0.0");
  });

  it("resolves relative URLs against sourceBaseUrl", () => {
    const result = webPageParser.parse(MINIMAL_PAGE, {
      versionSelector: "#release",
      downloadSelector: "#dl",
      sourceBaseUrl: "https://example.com/downloads/",
    });
    const artifact = result.releases[0]!.artifacts[0]!;
    expect(artifact.url).toBe("https://example.com/files/app.pkg");
    expect(artifact.type).toBe("pkg");
  });

  it("returns error when versionSelector is missing", () => {
    const result = webPageParser.parse(SAMPLE_PAGE, {
      downloadSelector: "a.download",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.confidence).toBe(0);
    expect(result.errors[0]).toContain("versionSelector");
  });

  it("returns a release with lower confidence when downloadSelector is missing", () => {
    const result = webPageParser.parse(SAMPLE_PAGE, {
      versionSelector: ".version",
      versionPattern: "([\\d.]+)",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("3.2.1");
    expect(result.releases[0]!.artifacts).toHaveLength(0);
    expect(result.confidence).toBe(50);
    expect(result.errors).toHaveLength(0);
  });

  it("returns error when version element is not found", () => {
    const result = webPageParser.parse(SAMPLE_PAGE, {
      versionSelector: ".nonexistent",
      downloadSelector: "a.download",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("No element matched");
  });

  it("returns error when versionPattern does not match", () => {
    const result = webPageParser.parse(MINIMAL_PAGE, {
      versionSelector: "#release",
      versionPattern: "^(v\\d+\\.\\d+\\.\\d+-beta)",
      downloadSelector: "#dl",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("did not match");
  });

  it("returns lower confidence when no downloads are found", () => {
    const page = '<html><body><span class="v">1.0</span></body></html>';
    const result = webPageParser.parse(page, {
      versionSelector: ".v",
      downloadSelector: "a.missing",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("1.0");
    expect(result.releases[0]!.artifacts).toHaveLength(0);
    expect(result.confidence).toBe(50);
  });

  it("detects prerelease versions", () => {
    const page =
      '<html><body><span id="v">4.0.0-beta.2</span><a id="d" href="/app.dmg">DL</a></body></html>';
    const result = webPageParser.parse(page, {
      versionSelector: "#v",
      downloadSelector: "#d",
      sourceBaseUrl: "https://example.com",
    });
    const release = result.releases[0]!;
    expect(release.isPrerelease).toBe(true);
    expect(release.channel).toBe("beta");
  });

  it("handles invalid HTML gracefully", () => {
    const result = webPageParser.parse("not html at all <<<>>>", {
      versionSelector: ".v",
      downloadSelector: "a",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("No element matched");
  });
});
