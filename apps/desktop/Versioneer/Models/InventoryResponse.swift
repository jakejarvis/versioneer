import Foundation

/// Response from `POST /v1/inventory/check`.
nonisolated struct InventoryCheckResponse: Codable, Sendable {
  let results: [AppDecision]
  let skipped: [SkippedApp]?
  let processedAt: String

  struct SkippedApp: Codable, Sendable {
    let index: Int
    let appName: String?
    let reasons: [String]
  }
}
