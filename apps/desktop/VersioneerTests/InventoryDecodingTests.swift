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
            "trackingState": "public",
            "localReasonCode": null,
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
            "decision": "local_only",
            "trackingState": "local_only",
            "localReasonCode": "not_found",
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
    #expect(result.decision == .localOnly)
    #expect(result.latestVersion == nil)
  }

  @Test func decodesAllDecisionTypes() throws {
    let decisions = [
      "up_to_date", "update_available", "ambiguous", "local_only", "incompatible",
    ]

    for decisionStr in decisions {
      let trackingState =
        decisionStr == "up_to_date" || decisionStr == "update_available"
          || decisionStr == "incompatible"
        ? "public" : "local_only"
      let localReasonCode: String? =
        switch decisionStr {
        case "ambiguous":
          "ambiguous_match"
        case "local_only":
          "not_found"
        case "incompatible":
          "no_compatible_release"
        default:
          nil
        }
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
              "trackingState": "\(trackingState)",
              "localReasonCode": \(localReasonCode.map { "\"\($0)\"" } ?? "null"),
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
          architecture: nil,
          sparkleFeedUrl: nil,
          sparklePublicKey: nil,
          isSparkleApp: nil,
          isMasApp: true,
          masAppId: "1569813296",
          isElectronApp: nil,
          electronUpdateProvider: nil,
          electronUpdateUrl: nil,
          codeSigningAuthority: nil,
          appCategory: nil,
          minMacOSVersion: nil,
          iconBase64: nil,
          isHomebrewInstalled: nil,
          homebrewCaskToken: nil
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
    #expect(apps[0]["masAppId"] as? String == "1569813296")
  }
}
