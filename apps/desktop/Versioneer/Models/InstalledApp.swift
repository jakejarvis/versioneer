import Foundation

/// Represents a locally discovered app bundle on disk.
nonisolated struct InstalledApp: Identifiable, Codable, Sendable {
  var id: String { bundleId ?? path }

  let name: String
  let bundleId: String?
  let version: String?
  let buildNumber: String?
  let teamId: String?
  let path: String
  let architecture: String?

  // Sparkle update metadata
  let sparkleFeedUrl: String?
  let sparklePublicKey: String?
  let isSparkleApp: Bool

  // Mac App Store
  let isMasApp: Bool

  // Electron auto-updater
  let isElectronApp: Bool
  let electronUpdateProvider: String?
  let electronUpdateUrl: String?

  // Code signing & system metadata
  let codeSigningAuthority: String?
  let appCategory: String?
  let minMacOSVersion: String?
}
