import Testing

@testable import Versioneer

struct ElectronCheckerTests {
  @Test func genericFeedResolvesRelativeAssetUrl() async {
    let checker = ElectronChecker()
    let yaml = """
      version: 1.2.3
      files:
        - url: releases/Versioneer-1.2.3-arm64.dmg
          sha512: ignored
      path: Versioneer-1.2.3-arm64.dmg
      releaseDate: '2026-03-31T12:00:00Z'
      """

    let result = await checker.parseLatestMacYml(
      yaml,
      updateUrl: "https://updates.example.com/downloads"
    )

    #expect(result?.latestVersion == "1.2.3")
    #expect(result?.downloadUrl == "https://updates.example.com/downloads/releases/Versioneer-1.2.3-arm64.dmg")
    #expect(result?.publishedAt == "2026-03-31T12:00:00Z")
  }

  @Test func genericFeedPrefersInstallableAssetOverBlockmap() async {
    let checker = ElectronChecker()
    let yaml = """
      version: 1.2.3
      files:
        - url: releases/Versioneer-1.2.3-mac.zip.blockmap
          sha512: ignored
        - url: releases/Versioneer-1.2.3-mac.zip
          sha512: ignored
      releaseDate: '2026-03-31T12:00:00Z'
      """

    let result = await checker.parseLatestMacYml(
      yaml,
      updateUrl: "https://updates.example.com/downloads"
    )

    #expect(result?.downloadUrl == "https://updates.example.com/downloads/releases/Versioneer-1.2.3-mac.zip")
  }
}
