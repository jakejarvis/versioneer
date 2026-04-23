import Foundation

/// Response from `POST /v1/inventory/check`.
nonisolated struct InventoryCheckResponse: Codable, Sendable {
  let results: [InventoryResult]
  let issues: Issues
  let processedAt: String

  struct Issues: Codable, Sendable {
    let invalidApps: [InvalidApp]
  }

  struct InvalidApp: Codable, Sendable {
    let index: Int
    let appName: String?
    let reasons: [String]
  }
}
