import Foundation

/// Response from `POST /v1/inventory/check`.
nonisolated struct InventoryCheckResponse: Codable, Sendable {
  let results: [AppDecision]
  let processedAt: String
}
