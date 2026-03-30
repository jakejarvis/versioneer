import { describe, it, expect } from "vitest";

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
});
