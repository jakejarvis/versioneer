import Foundation
import Testing

@testable import Versioneer

struct AppStoreCheckerTests {
  private let checker = AppStoreChecker()

  // MARK: - Response parsing

  @Test func parsesValidLookupResponse() async {
    let json = """
      {
        "resultCount": 1,
        "results": [{
          "trackId": 497799835,
          "version": "16.0",
          "releaseNotes": "Bug fixes and performance improvements.",
          "currentVersionReleaseDate": "2024-09-16T17:00:00Z"
        }]
      }
      """
    let data = json.data(using: .utf8)!
    let result = checker.parseResponse(data)
    #expect(result != nil)
    #expect(result?.masAppId == "497799835")
    #expect(result?.latestVersion == "16.0")
    #expect(result?.releaseNotes == "Bug fixes and performance improvements.")
    #expect(result?.releaseDate == "2024-09-16T17:00:00Z")
  }

  @Test func returnsNilForEmptyResults() async {
    let json = """
      {
        "resultCount": 0,
        "results": []
      }
      """
    let data = json.data(using: .utf8)!
    let result = checker.parseResponse(data)
    #expect(result == nil)
  }

  @Test func returnsNilForMalformedJSON() async {
    let data = "not json at all".data(using: .utf8)!
    let result = checker.parseResponse(data)
    #expect(result == nil)
  }

  @Test func returnsNilWhenTrackIdMissing() async {
    let json = """
      {
        "resultCount": 1,
        "results": [{
          "version": "1.0"
        }]
      }
      """
    let data = json.data(using: .utf8)!
    let result = checker.parseResponse(data)
    #expect(result == nil)
  }

  @Test func handlesResponseWithNullReleaseNotes() async {
    let json = """
      {
        "resultCount": 1,
        "results": [{
          "trackId": 883878097,
          "version": "5.8.0",
          "currentVersionReleaseDate": "2024-06-10T17:00:00Z"
        }]
      }
      """
    let data = json.data(using: .utf8)!
    let result = checker.parseResponse(data)
    #expect(result != nil)
    #expect(result?.masAppId == "883878097")
    #expect(result?.latestVersion == "5.8.0")
    #expect(result?.releaseNotes == nil)
  }

  // MARK: - checkAll integration

  @Test func returnsEmptyWhenNoMasApps() async {
    let apps = [makeNonMasInstalledApp(name: "Firefox", bundleId: "org.mozilla.firefox")]
    let results = await checker.checkAll(apps: apps)
    #expect(results.isEmpty)
  }

  // MARK: - Helpers

  private func makeNonMasInstalledApp(name: String, bundleId: String) -> InstalledApp {
    InstalledApp(
      name: name,
      bundleId: bundleId,
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Applications/\(name).app",
      architecture: nil,
      sparkleFeedUrl: nil,
      sparklePublicKey: nil,
      isSparkleApp: false,
      isMasApp: false,
      masAppId: nil,
      isElectronApp: false,
      electronUpdateProvider: nil,
      electronUpdateUrl: nil,
      codeSigningAuthority: nil,
      appCategory: nil,
      minMacOSVersion: nil,
      isHomebrewInstalled: false,
      homebrewCaskToken: nil
    )
  }
}
