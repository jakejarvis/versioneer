import Foundation
import Testing

@testable import Versioneer

struct InstallPlanDecodingTests {
  @Test func decodesInstallPrepareResponse() throws {
    let json = """
      {
        "executionId": "exec_123",
        "strategy": "zip_replace",
        "appId": "app_firefox",
        "releaseId": "rel_456",
        "artifact": {
          "id": "art_789",
          "downloadUrl": "https://example.com/firefox.zip",
          "architecture": "universal",
          "minOsVersion": "13.0",
          "artifactType": "zip",
          "sizeBytes": 123456,
          "sha256": "abc123"
        }
      }
      """

    let response = try JSONDecoder().decode(InstallPrepareResponse.self, from: Data(json.utf8))

    #expect(response.executionId == "exec_123")
    #expect(response.strategy == .zipReplace)
    #expect(response.appId == "app_firefox")
    #expect(response.releaseId == "rel_456")
    #expect(response.artifact?.id == "art_789")
    #expect(response.artifact?.sha256 == "abc123")
  }
}
