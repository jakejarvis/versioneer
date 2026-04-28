import Foundation
import Testing

@testable import Versioneer

struct APIContractAlignmentTests {
  @Test func inventoryResponseDecodesBackendShapeWithIconUrlAndInstallMetadata() throws {
    let json = """
      {
        "processedAt": "2026-03-26T18:00:00Z",
        "issues": { "invalidApps": [] },
        "results": [
          {
            "app": {
              "name": "Firefox",
              "bundleId": "org.mozilla.firefox",
              "installedVersion": "126.0"
            },
            "decision": "update_available",
            "catalog": {
              "match": {
                "appId": "app_firefox",
                "appName": "Mozilla Firefox",
                "confidence": 98.0
              },
              "trackingState": "public",
              "localReasonCode": null,
              "iconUrl": "https://assets.example.com/firefox.png",
              "staleSince": null
            },
            "release": {
              "version": "127.0",
              "versionRaw": "127.0",
              "releaseId": "rel_firefox",
              "targetArchitecture": "arm64",
              "releasedAt": "2026-03-20T12:00:00Z",
              "artifact": {
                "id": "artifact_firefox",
                "downloadUrl": "https://example.com/firefox.zip",
                "architecture": "universal",
                "minOsVersion": "13.0",
                "artifactType": "zip",
                "sizeBytes": 182452384,
                "sha256": "abc123"
              }
            },
            "install": {
              "strategy": "zip_replace",
              "trust": {
                "status": "one_click",
                "resolvedStrategy": "zip_replace",
                "reasons": []
              },
              "homebrewCaskToken": null
            },
            "channels": { "selected": "stable", "available": ["stable", "beta"] }
          }
        ]
      }
      """

    let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: Data(json.utf8))
    let result = try #require(response.results.first)

    #expect(result.latestReleaseId == "rel_firefox")
    #expect(result.targetArchitecture == "arm64")
    #expect(result.iconUrl == "https://assets.example.com/firefox.png")
    #expect(result.installStrategy == .zipReplace)
    #expect(result.installTrust.status == .oneClick)
    #expect(result.installTrust.resolvedStrategy == .zipReplace)
    #expect(result.isVerified == true)
    #expect(result.canInstall == true)
  }

  @Test func inventoryResponseDecodesInvalidApps() throws {
    let json = """
      {
        "processedAt": "2026-04-07T12:00:00Z",
        "results": [],
        "issues": {
          "invalidApps": [
            {
              "index": 112,
              "appName": "BrokenApp",
              "reasons": ["sparkleFeedUrl: Invalid URL"]
            }
          ]
        }
      }
      """

    let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: Data(json.utf8))
    #expect(response.issues.invalidApps.count == 1)
    #expect(response.issues.invalidApps[0].index == 112)
    #expect(response.issues.invalidApps[0].appName == "BrokenApp")
    #expect(response.issues.invalidApps[0].reasons == ["sparkleFeedUrl: Invalid URL"])
  }

  @Test func inventoryResponseRequiresIssuesField() throws {
    let json = """
      {
        "processedAt": "2026-04-07T12:00:00Z",
        "results": []
      }
      """

    do {
      _ = try JSONDecoder().decode(InventoryCheckResponse.self, from: Data(json.utf8))
      Issue.record("Expected decoding to fail when issues is missing")
    } catch {}
  }

  @Test func inventoryCompletenessAcceptsResultsPlusInvalidApps() throws {
    let json = """
      {
        "processedAt": "2026-04-07T12:00:00Z",
        "issues": {
          "invalidApps": [
            {
              "index": 1,
              "appName": "Broken App",
              "reasons": ["appName: Required"]
            }
          ]
        },
        "results": [
          {
            "app": {
              "name": "Found App",
              "bundleId": "com.example.found",
              "installedVersion": "1.0"
            },
            "decision": "local_only",
            "catalog": {
              "match": { "appId": null, "appName": null, "confidence": null },
              "trackingState": "local_only",
              "localReasonCode": "not_found",
              "iconUrl": null,
              "staleSince": null
            },
            "release": {
              "version": null,
              "versionRaw": null,
              "releaseId": null,
              "releasedAt": null,
              "targetArchitecture": null,
              "artifact": null
            },
            "install": {
              "strategy": null,
              "trust": {
                "status": "none",
                "resolvedStrategy": null,
                "reasons": []
              },
              "homebrewCaskToken": null
            },
            "channels": { "selected": null, "available": [] }
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
        "issues": { "invalidApps": [] },
        "results": [
          {
            "app": {
              "name": "Only App",
              "bundleId": "com.example.only",
              "installedVersion": "1.0"
            },
            "decision": "local_only",
            "catalog": {
              "match": { "appId": null, "appName": null, "confidence": null },
              "trackingState": "local_only",
              "localReasonCode": "not_found",
              "iconUrl": null,
              "staleSince": null
            },
            "release": {
              "version": null,
              "versionRaw": null,
              "releaseId": null,
              "releasedAt": null,
              "targetArchitecture": null,
              "artifact": null
            },
            "install": {
              "strategy": null,
              "trust": {
                "status": "none",
                "resolvedStrategy": null,
                "reasons": []
              },
              "homebrewCaskToken": null
            },
            "channels": { "selected": null, "available": [] }
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

  @Test func feedbackRequestsEncodeBackendEnvelope() throws {
    let wrongMatch = FeedbackAPIClient.submitRequest(
      for: FeedbackRequest.WrongMatch(
        appName: "Test App",
        bundleId: "com.example.test",
        matchedAppId: "app_test",
        comment: "Wrong catalog match"
      )
    )
    #expect(wrongMatch.feedbackType == "wrong_match")
    #expect(wrongMatch.appName == "Test App")
    #expect(wrongMatch.bundleId == "com.example.test")
    #expect(wrongMatch.matchedAppId == "app_test")
    #expect(wrongMatch.payload.comment == "Wrong catalog match")

    let wrongVersion = FeedbackAPIClient.submitRequest(
      for: FeedbackRequest.WrongVersion(
        appName: "Test App",
        bundleId: "com.example.test",
        matchedAppId: "app_test",
        reportedLatestVersion: "2.0",
        comment: "Expected 2.0"
      )
    )
    #expect(wrongVersion.feedbackType == "wrong_version")
    #expect(wrongVersion.payload.reportedLatestVersion == "2.0")
    #expect(wrongVersion.payload.comment == "Expected 2.0")

    let missingApp = FeedbackAPIClient.submitRequest(
      for: FeedbackRequest.MissingApp(
        appName: "New App",
        bundleId: "com.example.new",
        homepageUrl: "https://example.com",
        comment: nil
      )
    )
    #expect(missingApp.feedbackType == "app_request")
    #expect(missingApp.appName == "New App")
    #expect(missingApp.bundleId == "com.example.new")
    #expect(missingApp.matchedAppId == nil)
    #expect(missingApp.payload.homepageUrl == "https://example.com")
  }

  @Test func releaseNotesResponseDecodesMarkdownAndLegacyHtml() throws {
    let json = """
      {
        "releaseId": "rel_firefox",
        "appId": "app_firefox",
        "versionRaw": "127.0",
        "releaseNotesMarkdown": "## Changes\\n\\n- Fixed bugs",
        "releaseNotesHtml": null,
        "releaseNotesUrl": "https://example.com/releases/127"
      }
      """

    let response = try JSONDecoder().decode(
      InventoryAPIClient.ReleaseNotesResponse.self,
      from: Data(json.utf8)
    )

    #expect(response.releaseNotesMarkdown == "## Changes\n\n- Fixed bugs")
    #expect(response.releaseNotesHtml == nil)
    #expect(response.releaseNotesUrl == "https://example.com/releases/127")

    let legacyJson = """
      {
        "releaseId": "rel_legacy",
        "appId": "app_legacy",
        "versionRaw": "1.0",
        "releaseNotesMarkdown": null,
        "releaseNotesHtml": "<p>Legacy notes</p>",
        "releaseNotesUrl": null
      }
      """

    let legacyResponse = try JSONDecoder().decode(
      InventoryAPIClient.ReleaseNotesResponse.self,
      from: Data(legacyJson.utf8)
    )

    #expect(legacyResponse.releaseNotesMarkdown == nil)
    #expect(legacyResponse.releaseNotesHtml == "<p>Legacy notes</p>")
  }
}
