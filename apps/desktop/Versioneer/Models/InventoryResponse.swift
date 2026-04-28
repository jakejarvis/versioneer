import Foundation

/// Response from `POST /v1/inventory/check`.
nonisolated struct InventoryCheckResponse: Codable, Sendable {
  let results: [InventoryResult]
  let issues: Issues
  let processedAt: String
  let submission: Submission?
  let iconUpload: IconUpload?

  struct Issues: Codable, Sendable {
    let invalidApps: [InvalidApp]
  }

  struct InvalidApp: Codable, Sendable {
    let index: Int
    let appName: String?
    let reasons: [String]
  }

  struct Submission: Codable, Sendable {
    let id: String
  }

  struct IconUpload: Codable, Sendable {
    let uploadPath: String
    let items: [Item]

    struct Item: Codable, Sendable {
      let uploadID: String
      let lookupKey: String
      let appName: String
      let bundleId: String?
      let reason: Reason

      private enum CodingKeys: String, CodingKey {
        case uploadID = "uploadId"
        case lookupKey, appName, bundleId, reason
      }
    }

    enum Reason: String, Codable, Sendable {
      case discoveredIcon = "discovered_icon"
      case catalogIcon = "catalog_icon"
    }
  }
}
