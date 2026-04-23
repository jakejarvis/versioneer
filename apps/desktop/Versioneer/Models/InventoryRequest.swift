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
    let channels: Channels?
  }

  struct Channels: Codable, Sendable {
    let defaultChannel: String
    let overrides: [String: String]

    private enum CodingKeys: String, CodingKey {
      case defaultChannel = "default"
      case overrides
    }
  }

  /// The per-app payload shape expected by the backend.
  struct InventoryApp: Codable, Sendable {
    let appName: String
    let bundleId: String?
    let version: String?
    let buildNumber: String?
    let teamId: String?
    let architecture: String?
    let sparkleFeedUrl: String?
    let sparklePublicKey: String?
    let isSparkleApp: Bool?
    let isMasApp: Bool?
    let masAppId: String?
    let isElectronApp: Bool?
    let electronUpdateProvider: String?
    let electronUpdateUrl: String?
    let codeSigningAuthority: String?
    let appCategory: String?
    let minMacOSVersion: String?
    let iconBase64: String?
    let isHomebrewInstalled: Bool?
    let homebrewCaskToken: String?
  }
}
