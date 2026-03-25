import { describe, it, expect } from "vitest";

import { sparkleParser } from "../sparkle";

const SAMPLE_APPCAST = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>My App Changelog</title>
    <item>
      <title>Version 2.1.0</title>
      <sparkle:shortVersionString>2.1.0</sparkle:shortVersionString>
      <sparkle:version>210</sparkle:version>
      <pubDate>Mon, 15 Jan 2024 12:00:00 +0000</pubDate>
      <sparkle:releaseNotesLink>https://example.com/notes/2.1.0</sparkle:releaseNotesLink>
      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>
      <enclosure url="https://example.com/download/MyApp-2.1.0.dmg" length="15000000" type="application/octet-stream" sparkle:edSignature="abc123"/>
    </item>
    <item>
      <title>Version 2.0.0</title>
      <sparkle:shortVersionString>2.0.0</sparkle:shortVersionString>
      <sparkle:version>200</sparkle:version>
      <pubDate>Fri, 01 Dec 2023 12:00:00 +0000</pubDate>
      <enclosure url="https://example.com/download/MyApp-2.0.0.zip" length="12000000" type="application/octet-stream"/>
    </item>
  </channel>
</rss>`;

describe("sparkleParser", () => {
  it("parses appcast with multiple items", () => {
    const result = sparkleParser.parse(SAMPLE_APPCAST);
    expect(result.releases).toHaveLength(2);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.errors).toHaveLength(0);
  });

  it("extracts version correctly", () => {
    const result = sparkleParser.parse(SAMPLE_APPCAST);
    expect(result.releases[0]!.versionRaw).toBe("2.1.0");
    expect(result.releases[0]!.buildNumber).toBe("210");
  });

  it("extracts artifact info", () => {
    const result = sparkleParser.parse(SAMPLE_APPCAST);
    const artifact = result.releases[0]!.artifacts[0]!;
    expect(artifact.url).toBe("https://example.com/download/MyApp-2.1.0.dmg");
    expect(artifact.type).toBe("dmg");
    expect(artifact.sizeBytes).toBe(15000000);
    expect(artifact.minOsVersion).toBe("12.0");
    expect(artifact.signature).toBe("abc123");
  });

  it("extracts pubDate", () => {
    const result = sparkleParser.parse(SAMPLE_APPCAST);
    expect(result.releases[0]!.publishedAt).toBe("Mon, 15 Jan 2024 12:00:00 +0000");
  });

  it("handles empty body", () => {
    const result = sparkleParser.parse("");
    expect(result.releases).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });
});
