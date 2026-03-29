import Foundation
import Testing

@testable import Versioneer

struct InventoryDecodingTests {
  @Test func decodesFullResponse() throws {
    let json = """
      {
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
            "isVerified": true,
            "latestVersion": "126.0",
            "latestVersionRaw": "126.0",
            "releasedAt": "2024-06-10T00:00:00Z",
            "artifact": null
          }
        ]
      }
      """

    let data = Data(json.utf8)
    let response = try JSONDecoder().decode(
      InventoryCheckResponse.self,
      from: data
    )

    #expect(response.results.count == 1)

    let result = response.results[0]
    #expect(result.appName == "Firefox")
    #expect(result.bundleId == "org.mozilla.firefox")
    #expect(result.decision == .upToDate)
    #expect(result.matchConfidence == 95.0)
    #expect(result.latestVersion == "126.0")
    #expect(result.isVerified == true)
  }

  @Test func decodesNullableFields() throws {
    let json = """
      {
        "processedAt": "2024-06-15T10:30:00Z",
        "results": [
          {
            "appName": "SomeApp",
            "bundleId": null,
            "installedVersion": null,
            "matchedAppId": null,
            "matchedAppName": null,
            "matchConfidence": null,
            "decision": "not_tracked",
            "isVerified": false,
            "latestVersion": null,
            "latestVersionRaw": null,
            "releasedAt": null,
            "artifact": null
          }
        ]
      }
      """

    let data = Data(json.utf8)
    let response = try JSONDecoder().decode(
      InventoryCheckResponse.self,
      from: data
    )
    let result = response.results[0]

    #expect(result.bundleId == nil)
    #expect(result.installedVersion == nil)
    #expect(result.matchedAppId == nil)
    #expect(result.matchConfidence == nil)
    #expect(result.decision == .notTracked)
    #expect(result.latestVersion == nil)
  }

  @Test func decodesAllDecisionTypes() throws {
    let decisions = [
      "up_to_date", "update_available", "ambiguous", "not_tracked",
    ]

    for decisionStr in decisions {
      let json = """
        {
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
              "isVerified": false,
              "latestVersion": null,
              "latestVersionRaw": null,
              "releasedAt": null,
              "artifact": null
            }
          ]
        }
        """

      let data = Data(json.utf8)
      let response = try JSONDecoder().decode(
        InventoryCheckResponse.self,
        from: data
      )
      #expect(response.results[0].decision.rawValue == decisionStr)
    }
  }

  @Test func encodesInventoryRequest() throws {
    let request = InventoryCheckRequest(
      client: .init(
        platform: "macos",
        appVersion: "1.0",
        osVersion: "14.5",
        systemArchitecture: "arm64",
        channelPreferences: nil
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
          electronUpdateUrl: nil,
          codeSigningAuthority: nil,
          appCategory: nil,
          minMacOSVersion: nil,
          iconBase64: nil,
          isHomebrewInstalled: nil
        )
      ],
      scanDurationMs: 500
    )

    let data = try JSONEncoder().encode(request)
    let dict =
      try JSONSerialization.jsonObject(with: data) as! [String: Any]

    let client = dict["client"] as! [String: Any]
    #expect(client["platform"] as? String == "macos")

    let apps = dict["apps"] as! [[String: Any]]
    #expect(apps.count == 1)
    #expect(apps[0]["appName"] as? String == "Safari")
    #expect(apps[0]["bundleId"] as? String == "com.apple.Safari")
  }
}
