import Foundation

/// Response from `POST /v1/inventory/check`.
struct InventoryCheckResponse: Codable, Sendable {
    let snapshotId: String
    let results: [AppDecision]
    let processedAt: String
}
