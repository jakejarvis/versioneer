import Foundation
import Testing

@testable import Versioneer

struct InventoryDecodingTests {
  @Test func decodesFullResponse() throws {
    let json = """
      {
        "processedAt": "2024-06-15T10:30:00Z",
        "issues": { "invalidApps": [] },
        "results": [
          {
            "app": {
              "name": "Firefox",
              "bundleId": "org.mozilla.firefox",
              "installedVersion": "126.0"
            },
            "decision": "up_to_date",
            "catalog": {
              "match": {
                "appId": "app_xyz",
                "appName": "Mozilla Firefox",
                "confidence": 95.0
              },
              "trackingState": "public",
              "localReasonCode": null,
              "iconUrl": null,
              "staleSince": null
            },
            "release": {
              "version": "126.0",
              "versionRaw": "126.0",
              "releaseId": null,
              "releasedAt": "2024-06-10T00:00:00Z",
              "targetArchitecture": null,
              "artifact": null
            },
            "install": {
              "strategy": null,
              "trust": { "status": "none", "resolvedStrategy": null, "reasons": [] }
            },
            "channels": { "selected": "stable", "available": ["stable"] }
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
        "issues": { "invalidApps": [] },
        "results": [
          {
            "app": {
              "name": "SomeApp",
              "bundleId": null,
              "installedVersion": null
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
              "trust": { "status": "none", "resolvedStrategy": null, "reasons": [] }
            },
            "channels": { "selected": null, "available": [] }
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

  @Test func decodesSubmissionScopedIconUploadDescriptor() throws {
    let json = """
      {
        "processedAt": "2026-04-28T12:00:00Z",
        "submission": { "id": "invsub_123" },
        "iconUpload": {
          "uploadPath": "/v1/inventory/check/invsub_123/icons",
          "items": [
            {
              "uploadId": "iup_abc",
              "lookupKey": "bid:com.example.app",
              "appName": "Example",
              "bundleId": "com.example.app",
              "reason": "catalog_icon"
            }
          ]
        },
        "issues": { "invalidApps": [] },
        "results": []
      }
      """

    let response = try JSONDecoder().decode(InventoryCheckResponse.self, from: Data(json.utf8))
    #expect(response.submission?.id == "invsub_123")
    #expect(response.iconUpload?.uploadPath == "/v1/inventory/check/invsub_123/icons")
    #expect(response.iconUpload?.items.first?.uploadID == "iup_abc")
    #expect(response.iconUpload?.items.first?.reason == .catalogIcon)
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
          "issues": { "invalidApps": [] },
          "results": [
            {
              "app": {
                "name": "Test",
                "bundleId": null,
                "installedVersion": null
              },
              "decision": "\(decisionStr)",
              "catalog": {
                "match": { "appId": null, "appName": null, "confidence": null },
                "trackingState": "\(trackingState)",
                "localReasonCode": \(localReasonCode.map { "\"\($0)\"" } ?? "null"),
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
                "trust": { "status": "none", "resolvedStrategy": null, "reasons": [] }
              },
              "channels": { "selected": null, "available": [] }
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
        channels: nil
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

  @Test func lookupKeyMatchesBackendInventoryIdentity() {
    #expect(
      InventoryAPIClient.lookupKey(appName: "Example.app", bundleId: "COM.Example.App")
        == "bid:com.example.app")
    #expect(InventoryAPIClient.lookupKey(appName: "Example.app", bundleId: nil) == "name:example")
  }

  @Test func iconUploadSendsRequestedIconsInBatchesWithoutBlockingResults() async throws {
    let uploadItems = (0..<11).map { index in
      InventoryCheckResponse.IconUpload.Item(
        uploadID: "iup_\(index)",
        lookupKey: "bid:com.example.icon\(index)",
        appName: "Icon \(index)",
        bundleId: "com.example.icon\(index)",
        reason: .catalogIcon
      )
    }
    let missingItem = InventoryCheckResponse.IconUpload.Item(
      uploadID: "iup_missing",
      lookupKey: "bid:com.example.missing",
      appName: "Missing",
      bundleId: "com.example.missing",
      reason: .catalogIcon
    )
    let descriptor = InventoryCheckResponse.IconUpload(
      uploadPath: "/v1/inventory/check/invsub_icons/icons",
      items: uploadItems + [missingItem]
    )
    let apps = uploadItems.map { item in
      InstalledApp(
        name: item.appName,
        bundleId: item.bundleId,
        version: "1.0",
        buildNumber: nil,
        teamId: nil,
        path: "/Applications/\(item.appName).app",
        architecture: nil,
        sparkleFeedUrl: nil,
        sparklePublicKey: nil,
        isSparkleApp: false,
        isMasApp: false,
        masAppId: nil,
        isElectronApp: false,
        electronUpdateProvider: nil,
        electronUpdateUrl: nil,
        codeSigningAuthority: nil,
        appCategory: nil,
        minMacOSVersion: nil,
        isHomebrewInstalled: false,
        homebrewCaskToken: nil
      )
    }

    let firstResponse = iconUploadResponse(Array(uploadItems.prefix(10).map(\.uploadID)))
    let secondResponse = iconUploadResponse(Array(uploadItems.suffix(1).map(\.uploadID)))
    IconUploadURLProtocol.reset(responses: [firstResponse, secondResponse])
    let configuration = URLSessionConfiguration.ephemeral
    configuration.protocolClasses = [IconUploadURLProtocol.self]
    let session = URLSession(configuration: configuration)
    let client = InventoryAPIClient(
      baseURL: URL(string: "https://api.example.com")!, session: session)

    let summary = await client.uploadRequestedIcons(descriptor, from: apps) { _ in
      "aWNvbg=="
    }

    #expect(summary.requested == 12)
    #expect(summary.attempted == 11)
    #expect(summary.accepted == 11)
    #expect(summary.skipped == 1)
    #expect(summary.failed == 0)
    #expect(
      IconUploadURLProtocol.requestedPaths() == [
        "/v1/inventory/check/invsub_icons/icons",
        "/v1/inventory/check/invsub_icons/icons",
      ])
  }
}

private func iconUploadResponse(_ ids: [String]) -> Data {
  let results =
    ids
    .map { #"{"uploadId":"\#($0)","status":"accepted","retryable":false}"# }
    .joined(separator: ",")
  return Data(#"{"submissionId":"invsub_icons","results":[\#(results)]}"#.utf8)
}

private final class IconUploadURLProtocol: URLProtocol {
  private static let lock = NSLock()
  nonisolated(unsafe) private static var responses: [Data] = []
  nonisolated(unsafe) private static var paths: [String] = []

  static func reset(responses newResponses: [Data]) {
    lock.lock()
    responses = newResponses
    paths = []
    lock.unlock()
  }

  static func requestedPaths() -> [String] {
    lock.lock()
    defer { lock.unlock() }
    return paths
  }

  override class func canInit(with request: URLRequest) -> Bool {
    true
  }

  override class func canonicalRequest(for request: URLRequest) -> URLRequest {
    request
  }

  override func startLoading() {
    Self.lock.lock()
    Self.paths.append(request.url?.path ?? "")
    let body =
      Self.responses.isEmpty
      ? Data(#"{"submissionId":"invsub_icons","results":[]}"#.utf8)
      : Self.responses.removeFirst()
    Self.lock.unlock()

    let response = HTTPURLResponse(
      url: request.url!,
      statusCode: 200,
      httpVersion: nil,
      headerFields: ["Content-Type": "application/json"]
    )!
    client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
    client?.urlProtocol(self, didLoad: body)
    client?.urlProtocolDidFinishLoading(self)
  }

  override func stopLoading() {}
}
