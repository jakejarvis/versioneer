import { describe, it, expect } from "vite-plus/test";

import { xmlParser } from "../xml";

const PLIST_XML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>BundleVersion</key>
  <string>7172</string>
  <key>BundleShortVersionString</key>
  <string>6.3.3</string>
  <key>DownloadURL</key>
  <string>https://www.obdev.at/downloads/littlesnitch/LittleSnitch-6.3.3.dmg</string>
</dict>
</plist>`;

const SIMPLE_XML = `<?xml version="1.0"?>
<release>
  <version>2.1.0</version>
  <download url="https://example.com/app-2.1.0.zip"/>
</release>`;

describe("xmlParser", () => {
  it("extracts version from a simple XPath", () => {
    const result = xmlParser.parse(SIMPLE_XML, {
      versionXPath: "//version/text()",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("2.1.0");
    expect(result.confidence).toBe(50);
    expect(result.errors).toHaveLength(0);
  });

  it("extracts version and download URL", () => {
    const result = xmlParser.parse(SIMPLE_XML, {
      versionXPath: "//version/text()",
      downloadXPath: "//download/@url",
    });
    expect(result.releases[0]!.versionRaw).toBe("2.1.0");
    expect(result.releases[0]!.downloadUrl).toBe("https://example.com/app-2.1.0.zip");
    expect(result.releases[0]!.artifacts[0]!.type).toBe("zip");
    expect(result.confidence).toBe(70);
  });

  it("extracts from plist using sibling navigation", () => {
    const result = xmlParser.parse(PLIST_XML, {
      versionXPath: "//key[text()='BundleShortVersionString']/following-sibling::string[1]/text()",
      downloadXPath: "//key[text()='DownloadURL']/following-sibling::string[1]/text()",
    });
    expect(result.releases[0]!.versionRaw).toBe("6.3.3");
    expect(result.releases[0]!.downloadUrl).toBe(
      "https://www.obdev.at/downloads/littlesnitch/LittleSnitch-6.3.3.dmg",
    );
    expect(result.releases[0]!.artifacts[0]!.type).toBe("dmg");
  });

  it("extracts element text content (without /text())", () => {
    const result = xmlParser.parse(SIMPLE_XML, {
      versionXPath: "//version",
    });
    expect(result.releases[0]!.versionRaw).toBe("2.1.0");
  });

  it("returns error when versionXPath is missing", () => {
    const result = xmlParser.parse(SIMPLE_XML, {});
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("versionXPath");
  });

  it("returns error for invalid XPath expression", () => {
    const result = xmlParser.parse(SIMPLE_XML, {
      versionXPath: "///[invalid",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("Invalid versionXPath");
  });

  it("returns error when XPath matches nothing", () => {
    const result = xmlParser.parse(SIMPLE_XML, {
      versionXPath: "//nonexistent/text()",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors[0]).toContain("matched no value");
  });

  it("handles malformed XML gracefully", () => {
    const result = xmlParser.parse("not xml at all <<<>>>", {
      versionXPath: "//version/text()",
    });
    expect(result.releases).toHaveLength(0);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("detects prerelease versions", () => {
    const xml = "<r><version>3.0.0-beta.2</version></r>";
    const result = xmlParser.parse(xml, {
      versionXPath: "//version/text()",
    });
    expect(result.releases[0]!.isPrerelease).toBe(true);
    expect(result.releases[0]!.channel).toBe("beta");
  });

  it("resolves relative download URL against sourceBaseUrl", () => {
    const xml = '<r><v>1.0</v><d url="/files/app.pkg"/></r>';
    const result = xmlParser.parse(xml, {
      versionXPath: "//v/text()",
      downloadXPath: "//d/@url",
      sourceBaseUrl: "https://example.com",
    });
    expect(result.releases[0]!.downloadUrl).toBe("https://example.com/files/app.pkg");
  });

  it("extracts architecture metadata from artifact nodes", () => {
    const xml = `<?xml version="1.0"?>
<release>
  <version>5.0.0</version>
  <artifacts>
    <artifact arch="apple-silicon" sha256="armhash" size="1000" min_os="13.0">
      <url>/downloads/app-5.0.0-arm64.dmg</url>
    </artifact>
    <artifact arch="amd64" sha256="x86hash" size="1100" min_os="12.0">
      <url>/downloads/app-5.0.0-x64.dmg</url>
    </artifact>
  </artifacts>
</release>`;
    const result = xmlParser.parse(xml, {
      versionXPath: "//version/text()",
      artifactsXPath: "//artifact",
      artifactUrlXPath: "./url/text()",
      architectureXPath: "./@arch",
      sha256XPath: "./@sha256",
      sizeBytesXPath: "./@size",
      minOsVersionXPath: "./@min_os",
      sourceBaseUrl: "https://example.com",
    });

    expect(result.releases[0]!.artifacts).toEqual([
      expect.objectContaining({
        url: "https://example.com/downloads/app-5.0.0-arm64.dmg",
        architecture: "arm64",
        sha256: "armhash",
        sizeBytes: 1000,
        minOsVersion: "13.0",
      }),
      expect.objectContaining({
        url: "https://example.com/downloads/app-5.0.0-x64.dmg",
        architecture: "x86_64",
        sha256: "x86hash",
        sizeBytes: 1100,
        minOsVersion: "12.0",
      }),
    ]);
  });

  it("stores config in metadata", () => {
    const result = xmlParser.parse(SIMPLE_XML, {
      versionXPath: "//version/text()",
    });
    const meta = result.releases[0]!.metadata!;
    expect(meta.versionXPath).toBe("//version/text()");
    expect(meta.downloadXPath).toBeNull();
  });

  it("ignores download when downloadXPath matches nothing", () => {
    const result = xmlParser.parse(SIMPLE_XML, {
      versionXPath: "//version/text()",
      downloadXPath: "//nonexistent/@url",
    });
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.downloadUrl).toBeUndefined();
    expect(result.confidence).toBe(50);
  });

  describe("multi-release via releasesXPath", () => {
    const MULTI_XML = `<?xml version="1.0"?>
<releases>
  <release>
    <version>2.0.0</version>
    <download url="https://example.com/app-2.0.0.dmg"/>
  </release>
  <release>
    <version>2.1.0-beta1</version>
    <download url="https://example.com/app-2.1.0-beta1.dmg"/>
  </release>
  <release>
    <version>3.0.0</version>
    <download url="https://example.com/app-3.0.0.dmg"/>
  </release>
</releases>`;

    it("extracts multiple releases", () => {
      const result = xmlParser.parse(MULTI_XML, {
        releasesXPath: "//release",
        versionXPath: "./version/text()",
        downloadXPath: "./download/@url",
      });
      expect(result.releases).toHaveLength(3);
      expect(result.releases[0]!.versionRaw).toBe("2.0.0");
      expect(result.releases[0]!.downloadUrl).toBe("https://example.com/app-2.0.0.dmg");
      expect(result.releases[1]!.versionRaw).toBe("2.1.0-beta1");
      expect(result.releases[2]!.versionRaw).toBe("3.0.0");
      expect(result.confidence).toBe(70);
      expect(result.errors).toHaveLength(0);
    });

    it("infers channels and prerelease flags per release", () => {
      const result = xmlParser.parse(MULTI_XML, {
        releasesXPath: "//release",
        versionXPath: "./version/text()",
      });
      expect(result.releases[0]!.channel).toBe("stable");
      expect(result.releases[0]!.isPrerelease).toBe(false);
      expect(result.releases[1]!.channel).toBe("beta");
      expect(result.releases[1]!.isPrerelease).toBe(true);
    });

    it("returns error when releasesXPath matches nothing", () => {
      const result = xmlParser.parse(MULTI_XML, {
        releasesXPath: "//nonexistent",
        versionXPath: "./version/text()",
      });
      expect(result.releases).toHaveLength(0);
      expect(result.errors[0]).toContain("matched no elements");
    });

    it("skips elements with missing version", () => {
      const xml = `<?xml version="1.0"?>
<releases>
  <release><version>1.0.0</version></release>
  <release><notes>no version here</notes></release>
  <release><version>2.0.0</version></release>
</releases>`;
      const result = xmlParser.parse(xml, {
        releasesXPath: "//release",
        versionXPath: "./version/text()",
      });
      expect(result.releases).toHaveLength(2);
      expect(result.releases[0]!.versionRaw).toBe("1.0.0");
      expect(result.releases[1]!.versionRaw).toBe("2.0.0");
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it("stores releasesXPath in metadata", () => {
      const result = xmlParser.parse(MULTI_XML, {
        releasesXPath: "//release",
        versionXPath: "./version/text()",
      });
      expect(result.releases[0]!.metadata!.releasesXPath).toBe("//release");
    });

    it("confidence is 50 without download artifacts", () => {
      const result = xmlParser.parse(MULTI_XML, {
        releasesXPath: "//release",
        versionXPath: "./version/text()",
      });
      expect(result.confidence).toBe(50);
    });
  });
});
