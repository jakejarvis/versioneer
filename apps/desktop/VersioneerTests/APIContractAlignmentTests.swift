import Foundation
import Testing

@testable import Versioneer

struct APIContractAlignmentTests {
  @Test func inventoryResponseDecodesBackendShapeWithIconUrlAndInstallMetadata() throws {
    let json = """
      {
        "processedAt": "2026-03-26T18:00:00Z",
        "results": [
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
            "latestReleaseId": "rel_firefox",
            "releasedAt": "2026-03-20T12:00:00Z",
            "iconUrl": "https://assets.example.com/firefox.png",
            "artifact": {
              "id": "artifact_firefox",
              "downloadUrl": "https://example.com/firefox.zip",
              "architecture": "universal",
              "minOsVersion": "13.0",
              "artifactType": "zip",
              "sizeBytes": 182452384,
              "sha256": "abc123"
            },
            "installStrategy": "zip_replace"
          }
        ]
      }
      """

    let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: Data(json.utf8))
    let result = try #require(response.results.first)

    #expect(result.latestReleaseId == "rel_firefox")
    #expect(result.iconUrl == "https://assets.example.com/firefox.png")
    #expect(result.installStrategy == .zipReplace)
    #expect(result.isVerified == true)
    #expect(result.canInstall == true)
  }
}
