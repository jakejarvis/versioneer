import Foundation

/// Payload sent to `POST /v1/inventory/check`.
nonisolated struct InventoryCheckRequest: Codable, Sendable {
  let client: ClientInfo
  let apps: [InventoryApp]
  let scanDurationMs: Int?

  struct ClientInfo: Codable, Sendable {
    let platform: String
    let appVersion: String?
    let osVersion: String?
    let systemArchitecture: String?
    let channelPreferences: ChannelPreferences?
  }

  struct ChannelPreferences: Codable, Sendable {
    let defaultChannel: String
    let perApp: [String: String]
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
    let sparkleFeedUrl: String?
    let isMasApp: Bool?
    let electronUpdateUrl: String?
    let codeSigningAuthority: String?
    let appCategory: String?
    let minMacOSVersion: String?
    let iconBase64: String?
    let isHomebrewInstalled: Bool?
  }
}
