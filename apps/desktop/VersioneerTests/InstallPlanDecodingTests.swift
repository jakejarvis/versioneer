import Foundation
import Testing

@testable import Versioneer

struct InstallPlanTests {
  @Test func createsInstallPlanFromAppDecision() throws {
    let json = """
      {
        "appName": "Firefox",
        "bundleId": "org.mozilla.firefox",
        "installedVersion": "126.0",
        "matchedAppId": "app_firefox",
        "matchedAppName": "Mozilla Firefox",
        "matchConfidence": 98.0,
        "decision": "update_available",
        "isVerified": true,
        "latestVersion": "127.0",
        "latestVersionRaw": "127.0",
        "latestReleaseId": "rel_456",
        "releasedAt": "2026-03-20T12:00:00Z",
        "iconUrl": null,
        "artifact": {
          "id": "art_789",
          "downloadUrl": "https://example.com/firefox.zip",
          "architecture": "universal",
          "minOsVersion": "13.0",
          "artifactType": "zip",
          "sizeBytes": 123456,
          "sha256": "abc123"
        },
        "installStrategy": "zip_replace"
      }
      """

    let decision = try JSONDecoder().decode(AppDecision.self, from: Data(json.utf8))
    let plan = try #require(InstallPlan(result: decision))

    #expect(plan.strategy == .zipReplace)
    #expect(plan.appId == "app_firefox")
    #expect(plan.releaseId == "rel_456")
    #expect(plan.artifact?.id == "art_789")
    #expect(plan.artifact?.sha256 == "abc123")
    #expect(!plan.localId.isEmpty)
  }

  @Test func returnsNilForUninstallableDecision() throws {
    let json = """
      {
        "appName": "Firefox",
        "bundleId": "org.mozilla.firefox",
        "installedVersion": "127.0",
        "matchedAppId": "app_firefox",
        "matchedAppName": "Mozilla Firefox",
        "matchConfidence": 98.0,
        "decision": "up_to_date",
        "isVerified": true,
        "latestVersion": "127.0",
        "latestVersionRaw": "127.0",
        "latestReleaseId": "rel_456",
        "releasedAt": "2026-03-20T12:00:00Z",
        "iconUrl": null,
        "artifact": null,
        "installStrategy": null
      }
      """

    let decision = try JSONDecoder().decode(AppDecision.self, from: Data(json.utf8))
    let plan = InstallPlan(result: decision)

    #expect(plan == nil)
  }
}
