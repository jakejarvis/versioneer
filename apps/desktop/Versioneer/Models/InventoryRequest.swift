import Foundation

/// Payload sent to `POST /v1/inventory/check`.
struct InventoryCheckRequest: Codable, Sendable {
    let client: ClientInfo
    let apps: [InventoryApp]
    let scanDurationMs: Int?

    struct ClientInfo: Codable, Sendable {
        let installId: String
        let platform: String
        let appVersion: String?
        let osVersion: String?
    }

    /// The per-app payload shape expected by the backend.
    struct InventoryApp: Codable, Sendable {
        let appName: String
        let bundleId: String?
        let version: String?
        let buildNumber: String?
        let teamId: String?
        let pathHash: String?
        let architecture: String?
    }
}
