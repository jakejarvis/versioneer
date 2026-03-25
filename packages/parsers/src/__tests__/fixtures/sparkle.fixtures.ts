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
];
