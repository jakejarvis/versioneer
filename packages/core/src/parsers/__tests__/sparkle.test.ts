import { describe, it, expect } from "vite-plus/test";

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
      <description><![CDATA[<h2>Changes in 2.1.0</h2><ul><li>Bug fix</li><li>Performance improvement</li></ul>]]></description>
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

  it("extracts inline description HTML", () => {
    const result = sparkleParser.parse(SAMPLE_APPCAST);
    expect(result.releases[0]!.releaseNotesBody).toBe(
      "<h2>Changes in 2.1.0</h2><ul><li>Bug fix</li><li>Performance improvement</li></ul>",
    );
    expect(result.releases[0]!.releaseNotesFormat).toBe("html");
  });

  it("omits releaseNotesBody when no description present", () => {
    const result = sparkleParser.parse(SAMPLE_APPCAST);
    expect(result.releases[1]!.releaseNotesBody).toBeUndefined();
    expect(result.releases[1]!.releaseNotesFormat).toBeUndefined();
  });

  it("handles empty body", () => {
    const result = sparkleParser.parse("");
    expect(result.releases).toHaveLength(0);
    expect(result.confidence).toBe(0);
  });

  it("skips delta update items", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <title>Version 2.1.0</title>
      <sparkle:shortVersionString>2.1.0</sparkle:shortVersionString>
      <sparkle:version>210</sparkle:version>
      <enclosure url="https://example.com/MyApp-2.1.0.dmg" length="15000000" type="application/octet-stream"/>
    </item>
    <item>
      <title>Version 2.1.0 Delta</title>
      <sparkle:shortVersionString>2.1.0</sparkle:shortVersionString>
      <sparkle:version>210</sparkle:version>
      <enclosure url="https://example.com/MyApp-2.0-to-2.1.delta" length="5000000" type="application/octet-stream" sparkle:deltaFrom="200"/>
    </item>
  </channel>
</rss>`;
    const result = sparkleParser.parse(xml);
    expect(result.releases).toHaveLength(1);
    expect(result.releases[0]!.versionRaw).toBe("2.1.0");
    expect(result.releases[0]!.artifacts[0]!.url).toBe("https://example.com/MyApp-2.1.0.dmg");
  });

  it("extracts sparkle:channel from items", () => {
    const xml = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <sparkle:shortVersionString>3.0.0-beta.1</sparkle:shortVersionString>
      <sparkle:version>300</sparkle:version>
      <sparkle:channel>beta</sparkle:channel>
      <enclosure url="https://example.com/MyApp-3.0b1.dmg" length="10000000" type="application/octet-stream"/>
    </item>
    <item>
      <sparkle:shortVersionString>2.5.0</sparkle:shortVersionString>
      <sparkle:version>250</sparkle:version>
      <enclosure url="https://example.com/MyApp-2.5.0.dmg" length="12000000" type="application/octet-stream"/>
    </item>
  </channel>
</rss>`;
    const result = sparkleParser.parse(xml);
    expect(result.releases).toHaveLength(2);
    expect(result.releases[0]!.channel).toBe("beta");
    expect(result.releases[1]!.channel).toBe("stable");
  });
});
