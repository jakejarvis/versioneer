import Foundation
import Testing

@testable import Versioneer

struct InventoryDecodingTests {
  @Test func decodesFullResponse() throws {
    let json = """
      {
        "snapshotId": "cis_abc123",
        "processedAt": "2024-06-15T10:30:00Z",
        "results": [
          {
            "appName": "Firefox",
            "bundleId": "org.mozilla.firefox",
            "installedVersion": "126.0",
            "matchedAppId": "app_xyz",
            "matchedAppName": "Mozilla Firefox",
            "matchConfidence": 95.0,
            "decision": "up_to_date",
            "latestVersion": "126.0",
            "latestVersionRaw": "126.0",
            "releasedAt": "2024-06-10T00:00:00Z",
            "artifact": null,
            "install": {
              "canInstall": false,
              "installabilityClass": null,
              "strategy": null,
              "requiresQuit": false,
              "requiresAdmin": false,
              "supportsSilent": false,
              "eligibility": "not_supported"
            }
          }
        ]
      }
      """

    let data = Data(json.utf8)
    let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: data)

    #expect(response.snapshotId == "cis_abc123")
    #expect(response.results.count == 1)

    let result = response.results[0]
    #expect(result.appName == "Firefox")
    #expect(result.bundleId == "org.mozilla.firefox")
    #expect(result.decision == .upToDate)
    #expect(result.matchConfidence == 95.0)
    #expect(result.latestVersion == "126.0")
  }

  @Test func decodesNullableFields() throws {
    let json = """
      {
        "snapshotId": "cis_xyz",
        "processedAt": "2024-06-15T10:30:00Z",
        "results": [
          {
            "appName": "SomeApp",
            "bundleId": null,
            "installedVersion": null,
            "matchedAppId": null,
            "matchedAppName": null,
            "matchConfidence": null,
            "decision": "unknown",
            "latestVersion": null,
            "latestVersionRaw": null,
            "releasedAt": null,
            "artifact": null,
            "install": {
              "canInstall": false,
              "installabilityClass": null,
              "strategy": null,
              "requiresQuit": false,
              "requiresAdmin": false,
              "supportsSilent": false,
              "eligibility": "not_supported"
            }
          }
        ]
      }
      """

    let data = Data(json.utf8)
    let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: data)
    let result = response.results[0]

    #expect(result.bundleId == nil)
    #expect(result.installedVersion == nil)
    #expect(result.matchedAppId == nil)
    #expect(result.matchConfidence == nil)
    #expect(result.decision == .unknown)
    #expect(result.latestVersion == nil)
  }

  @Test func decodesAllDecisionTypes() throws {
    let decisions = [
      "unknown", "up_to_date", "update_available", "ambiguous", "unsupported", "ignored",
    ]

    for decisionStr in decisions {
      let json = """
        {
          "snapshotId": "cis_test",
          "processedAt": "2024-01-01T00:00:00Z",
          "results": [
            {
              "appName": "Test",
              "bundleId": null,
              "installedVersion": null,
              "matchedAppId": null,
              "matchedAppName": null,
              "matchConfidence": null,
              "decision": "\(decisionStr)",
              "latestVersion": null,
              "latestVersionRaw": null,
              "releasedAt": null,
              "artifact": null,
              "install": {
                "canInstall": false,
                "installabilityClass": null,
                "strategy": null,
                "requiresQuit": false,
                "requiresAdmin": false,
                "supportsSilent": false,
                "eligibility": "not_supported"
              }
            }
          ]
        }
        """

      let data = Data(json.utf8)
      let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: data)
      #expect(response.results[0].decision.rawValue == decisionStr)
    }
  }

  @Test func encodesInventoryRequest() throws {
    let request = InventoryCheckRequest(
      client: .init(
        installId: "test-id",
        platform: "macos",
        appVersion: "1.0",
        osVersion: "14.5",
        systemArchitecture: "arm64"
      ),
      apps: [
        .init(
          appName: "Safari",
          bundleId: "com.apple.Safari",
          version: "17.5",
          buildNumber: nil,
          teamId: nil,
          pathHash: "abc123",
          architecture: nil,
          sparkleFeedUrl: nil,
          isMasApp: nil,
          electronUpdateUrl: nil
        )
      ],
      scanDurationMs: 500
    )

    let data = try JSONEncoder().encode(request)
    let dict = try JSONSerialization.jsonObject(with: data) as! [String: Any]

    let client = dict["client"] as! [String: Any]
    #expect(client["installId"] as? String == "test-id")
    #expect(client["platform"] as? String == "macos")

    let apps = dict["apps"] as! [[String: Any]]
    #expect(apps.count == 1)
    #expect(apps[0]["appName"] as? String == "Safari")
    #expect(apps[0]["bundleId"] as? String == "com.apple.Safari")
  }
}
