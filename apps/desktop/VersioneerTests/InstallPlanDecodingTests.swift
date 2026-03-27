import Foundation
import Testing

@testable import Versioneer

struct InstallPlanDecodingTests {
  @Test func decodesInstallPrepareResponse() throws {
    let json = """
      {
        "executionId": "exec_123",
        "plan": {
          "executionId": "exec_123",
          "appId": "app_firefox",
          "releaseId": "rel_456",
          "strategy": "zip_replace",
          "installabilityClass": "assisted_replace",
          "warningLevel": "none",
          "requiresQuit": true,
          "requiresAdmin": false,
          "supportsSilent": false,
          "relaunchAfterInstall": true,
          "artifact": {
            "id": "art_789",
            "downloadUrl": "https://example.com/firefox.zip",
            "architecture": "universal",
            "minOsVersion": "13.0",
            "artifactType": "zip",
            "sizeBytes": 123456,
            "sha256": "abc123",
            "expectedTeamId": "43AQ936H96",
            "expectedBundleId": "org.mozilla.firefox",
            "expectedVersionRaw": "126.0"
          },
          "localVerification": {
            "requireHash": true,
            "requireSignature": true,
            "requireNotarization": true,
            "requireBundleIdMatch": true,
            "requireTeamIdMatch": true,
            "requireVersionMatch": true
          }
        }
      }
      """

    let response = try JSONDecoder().decode(InstallPrepareResponse.self, from: Data(json.utf8))

    #expect(response.executionId == "exec_123")
    #expect(response.plan.strategy == .zipReplace)
    #expect(response.plan.installabilityClass == .assistedReplace)
    #expect(response.plan.artifact?.id == "art_789")
    #expect(response.plan.localVerification.requireHash)
  }
}
