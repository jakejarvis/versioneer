export interface SparkleFixture {
  name: string;
  xml: string;
  expectedReleaseCount: number;
  expectedFirstVersion?: string;
  expectedConfidence: number;
}

export const sparkleFixtures: SparkleFixture[] = [
  {
    name: "multi-item appcast",
    xml: `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <title>Test App</title>
    <item>
      <title>Version 2.0.0</title>
      <sparkle:version>2.0.0</sparkle:version>
      <sparkle:shortVersionString>2.0.0</sparkle:shortVersionString>
      <pubDate>Mon, 01 Jan 2026 12:00:00 +0000</pubDate>
      <enclosure url="https://example.com/app-2.0.0.dmg" sparkle:version="2.0.0" length="10485760" type="application/octet-stream"/>
    </item>
    <item>
      <title>Version 1.0.0</title>
      <sparkle:version>1.0.0</sparkle:version>
      <enclosure url="https://example.com/app-1.0.0.zip" length="5242880" type="application/octet-stream"/>
    </item>
  </channel>
</rss>`,
    expectedReleaseCount: 2,
    expectedFirstVersion: "2.0.0",
    expectedConfidence: 90,
  },
  {
    name: "single item with minimum system version",
    xml: `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <sparkle:version>3.1.0</sparkle:version>
      <sparkle:minimumSystemVersion>13.0</sparkle:minimumSystemVersion>
      <enclosure url="https://example.com/app.dmg" length="1024" type="application/octet-stream"/>
    </item>
  </channel>
</rss>`,
    expectedReleaseCount: 1,
    expectedFirstVersion: "3.1.0",
    expectedConfidence: 90,
  },
  {
    name: "empty channel",
    xml: `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel><title>Empty</title></channel>
</rss>`,
    expectedReleaseCount: 0,
    expectedConfidence: 0,
  },
  {
    name: "malformed XML",
    xml: `this is not XML at all`,
    expectedReleaseCount: 0,
    expectedConfidence: 0,
  },
  {
    name: "item missing version",
    xml: `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <title>No Version</title>
      <enclosure url="https://example.com/app.dmg" length="1024" type="application/octet-stream"/>
    </item>
  </channel>
</rss>`,
    expectedReleaseCount: 0,
    expectedConfidence: 0,
  },
  {
    name: "delta updates are skipped",
    xml: `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <sparkle:version>2.0.0</sparkle:version>
      <enclosure url="https://example.com/app-2.0.0.dmg" length="10485760" type="application/octet-stream"/>
    </item>
    <item>
      <sparkle:version>2.0.0</sparkle:version>
      <enclosure url="https://example.com/app-1.9-to-2.0.delta" length="2000000" type="application/octet-stream" sparkle:deltaFrom="1.9.0"/>
    </item>
  </channel>
</rss>`,
    expectedReleaseCount: 1,
    expectedFirstVersion: "2.0.0",
    expectedConfidence: 90,
  },
  {
    name: "enclosure-only version attributes (chronological feed)",
    xml: `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">
  <channel>
    <item>
      <title>Version 1.0</title>
      <pubDate>Mon, 01 Jan 2024 00:00:00 +0000</pubDate>
      <enclosure url="https://example.com/app-1.0.dmg" sparkle:version="100" sparkle:shortVersionString="1.0" length="5000000" type="application/octet-stream"/>
    </item>
    <item>
      <title>Version 2.0</title>
      <pubDate>Tue, 01 Oct 2024 00:00:00 +0000</pubDate>
      <enclosure url="https://example.com/app-2.0.dmg" sparkle:version="200" sparkle:shortVersionString="2.0" length="8000000" type="application/octet-stream"/>
    </item>
  </channel>
</rss>`,
    expectedReleaseCount: 2,
    expectedFirstVersion: "1.0",
    expectedConfidence: 90,
  },
];
