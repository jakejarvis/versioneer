import Foundation
import Testing
@testable import Versioneer

struct APIContractAlignmentTests {
    @Test func inventoryResponseDecodesBackendShapeWithIconUrlAndInstallMetadata() throws {
        let json = """
        {
          "snapshotId": "cis_contract",
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
                "sha256": "abc123",
                "expectedTeamId": "43AQ936H96",
                "expectedBundleId": "org.mozilla.firefox",
                "expectedVersionRaw": "127.0"
              },
              "install": {
                "canInstall": true,
                "installabilityClass": "assisted_replace",
                "strategy": "zip_replace",
                "requiresQuit": true,
                "requiresAdmin": false,
                "supportsSilent": false,
                "eligibility": "eligible"
              }
            }
          ]
        }
        """

        let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: Data(json.utf8))
        let result = try #require(response.results.first)

        #expect(result.latestReleaseId == "rel_firefox")
        #expect(result.iconUrl == "https://assets.example.com/firefox.png")
        #expect(result.artifact?.expectedBundleId == "org.mozilla.firefox")
        #expect(result.install.strategy == .zipReplace)
        #expect(result.install.installabilityClass == .assistedReplace)
    }

    @Test func installPrepareRequestEncodesBackendFieldNames() throws {
        let request = InstallPrepareRequest(
            installId: "install_test",
            snapshotId: "cis_contract",
            matchedAppId: "app_firefox",
            releaseId: "rel_firefox",
            installedVersion: "126.0",
            localAppPath: "/Applications/Firefox.app",
            strategyCandidate: .zipReplace
        )

        let payload = try encodedJSONObject(from: request)

        #expect(payload["installId"] as? String == "install_test")
        #expect(payload["snapshotId"] as? String == "cis_contract")
        #expect(payload["matchedAppId"] as? String == "app_firefox")
        #expect(payload["releaseId"] as? String == "rel_firefox")
        #expect(payload["localAppPath"] as? String == "/Applications/Firefox.app")
        #expect(payload["strategyCandidate"] as? String == "zip_replace")
    }

    @Test func installStatusUpdateEncodesBackendFieldNames() throws {
        let update = InstallExecutionStatusUpdate(
            installId: "install_test",
            actionStatus: .inProgress,
            clientVersionAfter: nil,
            errorMessage: nil,
            durationMs: 2100,
            detailsJson: "{\"phase\":\"installing\"}"
        )

        let payload = try encodedJSONObject(from: update)

        #expect(payload["installId"] as? String == "install_test")
        #expect(payload["actionStatus"] as? String == "in_progress")
        #expect(payload["durationMs"] as? Int == 2100)
        #expect(payload["detailsJson"] as? String == "{\"phase\":\"installing\"}")
    }

    private func encodedJSONObject<T: Encodable>(from value: T) throws -> [String: Any] {
        let data = try JSONEncoder().encode(value)
        return try #require(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }
}
