export interface GitHubFixture {
  name: string;
  json: string;
  expectedReleaseCount: number;
  expectedFirstVersion?: string;
  expectedConfidence: number;
}

export const githubFixtures: GitHubFixture[] = [
  {
    name: "standard releases",
    json: JSON.stringify([
      {
        tag_name: "v2.0.0",
        name: "Release 2.0.0",
        prerelease: false,
        draft: false,
        published_at: "2026-01-15T00:00:00Z",
        html_url: "https://github.com/org/repo/releases/tag/v2.0.0",
        assets: [
          {
            name: "App-2.0.0.dmg",
            browser_download_url:
              "https://github.com/org/repo/releases/download/v2.0.0/App-2.0.0.dmg",
            size: 10485760,
          },
        ],
      },
      {
        tag_name: "v1.0.0",
        name: "Release 1.0.0",
        prerelease: false,
        draft: false,
        published_at: "2025-06-01T00:00:00Z",
        html_url: "https://github.com/org/repo/releases/tag/v1.0.0",
        assets: [
          {
            name: "App-1.0.0.dmg",
            browser_download_url:
              "https://github.com/org/repo/releases/download/v1.0.0/App-1.0.0.dmg",
            size: 5242880,
          },
        ],
      },
    ]),
    expectedReleaseCount: 2,
    expectedFirstVersion: "2.0.0",
    expectedConfidence: 85,
  },
  {
    name: "pre-releases only",
    json: JSON.stringify([
      {
        tag_name: "v3.0.0-beta.1",
        prerelease: true,
        draft: false,
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/org/repo/releases/tag/v3.0.0-beta.1",
        assets: [
          {
            name: "App-3.0.0-beta.1-mac.zip",
            browser_download_url: "https://example.com/beta.zip",
            size: 1024,
          },
        ],
      },
    ]),
    expectedReleaseCount: 1,
    expectedFirstVersion: "3.0.0-beta.1",
    expectedConfidence: 85,
  },
  {
    name: "no mac assets",
    json: JSON.stringify([
      {
        tag_name: "v1.0.0",
        prerelease: false,
        draft: false,
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/org/repo/releases/tag/v1.0.0",
        assets: [
          {
            name: "app-linux-amd64.tar.gz",
            browser_download_url: "https://example.com/linux.tar.gz",
            size: 1024,
          },
          {
            name: "app-windows-x64.exe",
            browser_download_url: "https://example.com/windows.exe",
            size: 1024,
          },
        ],
      },
    ]),
    expectedReleaseCount: 1,
    expectedConfidence: 85,
  },
  {
    name: "draft releases excluded",
    json: JSON.stringify([
      {
        tag_name: "v1.0.0",
        prerelease: false,
        draft: true,
        published_at: "2026-01-01T00:00:00Z",
        html_url: "https://github.com/org/repo/releases/tag/v1.0.0",
        assets: [],
      },
    ]),
    expectedReleaseCount: 0,
    expectedConfidence: 0,
  },
  {
    name: "empty releases array",
    json: "[]",
    expectedReleaseCount: 0,
    expectedConfidence: 0,
  },
  {
    name: "malformed JSON",
    json: "not valid json {{{",
    expectedReleaseCount: 0,
    expectedConfidence: 0,
  },
];
