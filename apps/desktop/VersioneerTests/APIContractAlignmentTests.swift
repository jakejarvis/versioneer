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
            "trackingState": "public",
            "localReasonCode": null,
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

  @Test func inventoryResponseDecodesSkippedApps() throws {
    let json = """
      {
        "processedAt": "2026-04-07T12:00:00Z",
        "results": [],
        "skipped": [
          {
            "index": 112,
            "appName": "BrokenApp",
            "reasons": ["sparkleFeedUrl: Invalid URL"]
          }
        ]
      }
      """

    let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: Data(json.utf8))
    let skipped = try #require(response.skipped)
    #expect(skipped.count == 1)
    #expect(skipped[0].index == 112)
    #expect(skipped[0].appName == "BrokenApp")
    #expect(skipped[0].reasons == ["sparkleFeedUrl: Invalid URL"])
  }

  @Test func inventoryResponseDecodesWithoutSkippedField() throws {
    let json = """
      {
        "processedAt": "2026-04-07T12:00:00Z",
        "results": []
      }
      """

    let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: Data(json.utf8))
    #expect(response.skipped == nil)
  }

  @Test func inventoryCompletenessAcceptsResultsPlusSkipped() throws {
    let json = """
      {
        "processedAt": "2026-04-07T12:00:00Z",
        "results": [
          {
            "appName": "Found App",
            "bundleId": "com.example.found",
            "installedVersion": "1.0",
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
        ],
        "skipped": [
          {
            "index": 1,
            "appName": "Broken App",
            "reasons": ["appName: Required"]
          }
        ]
      }
      """

    let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: Data(json.utf8))
    try InventoryAPIClient.validateInventoryResponseCompleteness(response, submittedAppCount: 2)
  }

  @Test func inventoryCompletenessRejectsTruncatedResponse() throws {
    let json = """
      {
        "processedAt": "2026-04-07T12:00:00Z",
        "results": [
          {
            "appName": "Only App",
            "bundleId": "com.example.only",
            "installedVersion": "1.0",
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

    let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: Data(json.utf8))

    do {
      try InventoryAPIClient.validateInventoryResponseCompleteness(response, submittedAppCount: 2)
      Issue.record("Expected truncated inventory response to fail validation")
    } catch APIError.incompleteInventoryResponse(let expected, let received) {
      #expect(expected == 2)
      #expect(received == 1)
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func preflightResponseDecodesDismissedBundleIds() throws {
    let json = """
      {
        "dismissedBundleIds": ["com.adobe.Install", "com.google.keystone.agent"]
      }
      """

    let response = try JSONDecoder().decode(PreflightResponse.self, from: Data(json.utf8))
    #expect(response.dismissedBundleIds.count == 2)
    #expect(response.dismissedBundleIds.contains("com.adobe.Install"))
    #expect(response.dismissedBundleIds.contains("com.google.keystone.agent"))
  }

  @Test func preflightResponseDecodesEmptyList() throws {
    let json = """
      {
        "dismissedBundleIds": []
      }
      """

    let response = try JSONDecoder().decode(PreflightResponse.self, from: Data(json.utf8))
    #expect(response.dismissedBundleIds.isEmpty)
  }
}
