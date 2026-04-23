import Foundation

/// A single inventory result for an installed app.
nonisolated struct InventoryResult: Identifiable, Codable, Hashable, Sendable {
  let app: AppInfo
  let decision: Decision
  let catalog: CatalogInfo
  let release: ReleaseInfo
  let install: InstallInfo
  let channels: ChannelInfo
  let localAppID: String?

  var id: String {
    Self.makeID(
      appName: app.name,
      bundleId: app.bundleId,
      matchedAppId: catalog.match.appID,
      localAppID: localAppID
    )
  }

  struct AppInfo: Codable, Hashable, Sendable {
    let name: String
    let bundleId: String?
    let installedVersion: String?
  }

  struct CatalogInfo: Codable, Hashable, Sendable {
    let match: Match
    let trackingState: TrackingState
    let localReasonCode: LocalReasonCode?
    let iconURL: String?
    let staleSince: String?

    private enum CodingKeys: String, CodingKey {
      case match, trackingState, localReasonCode, iconURL = "iconUrl", staleSince
    }
  }

  struct Match: Codable, Hashable, Sendable {
    let appID: String?
    let appName: String?
    let confidence: Double?

    private enum CodingKeys: String, CodingKey {
      case appID = "appId", appName, confidence
    }
  }

  struct ReleaseInfo: Codable, Hashable, Sendable {
    let version: String?
    let versionRaw: String?
    let releaseID: String?
    let releasedAt: String?
    let targetArchitecture: String?
    let artifact: Artifact?

    private enum CodingKeys: String, CodingKey {
      case version, versionRaw, releaseID = "releaseId", releasedAt, targetArchitecture, artifact
    }
  }

  struct InstallInfo: Codable, Hashable, Sendable {
    let strategy: InstallStrategy?
    let trust: InstallTrust
    let homebrewCaskToken: String?
  }

  struct ChannelInfo: Codable, Hashable, Sendable {
    let selected: String?
    let available: [String]
  }

  enum Decision: String, Codable, Sendable, CaseIterable {
    case upToDate = "up_to_date"
    case updateAvailable = "update_available"
    case ambiguous
    case localOnly = "local_only"
    case incompatible
  }

  enum TrackingState: String, Codable, Sendable, CaseIterable {
    case catalog = "public"
    case localOnly = "local_only"
  }

  enum LocalReasonCode: String, Codable, Sendable, CaseIterable {
    case noPublicIdentity = "no_public_identity"
    case noApprovedSource = "no_approved_source"
    case matchedDraft = "matched_draft"
    case ambiguousMatch = "ambiguous_match"
    case notFound = "not_found"
    case noCompatibleRelease = "no_compatible_release"
  }

  struct Artifact: Codable, Hashable, Sendable {
    let id: String?
    let downloadUrl: String?
    let architecture: String?
    let minOsVersion: String?
    let artifactType: String?
    let sizeBytes: Int?
    let sha256: String?
  }

  struct InstallTrust: Codable, Hashable, Sendable {
    let status: Status
    let resolvedStrategy: InstallStrategy?
    let reasons: [Reason]

    enum Status: String, Codable, Sendable, CaseIterable {
      case oneClick = "one_click"
      case manualOnly = "manual_only"
      case external
      case none
    }

    enum Reason: String, Codable, Sendable, CaseIterable {
      case missingArtifact = "missing_artifact"
      case missingSHA256 = "missing_sha256"
      case missingBundleID = "missing_bundle_id"
      case missingTeamID = "missing_team_id"
      case missingSparklePublicKey = "missing_sparkle_public_key"
      case macAppStoreExternal = "mac_app_store_external"
      case homebrewExternal = "homebrew_external"
      case manualOnly = "manual_only"
      case unsupportedStrategy = "unsupported_strategy"
      case unknownArchitecture = "unknown_architecture"
    }

    static func `default`(for installStrategy: InstallStrategy?) -> InstallTrust {
      if let installStrategy {
        return InstallTrust(status: .oneClick, resolvedStrategy: installStrategy, reasons: [])
      }
      return InstallTrust(status: .none, resolvedStrategy: nil, reasons: [])
    }
  }

  init(
    app: AppInfo,
    decision: Decision,
    catalog: CatalogInfo,
    release: ReleaseInfo,
    install: InstallInfo,
    channels: ChannelInfo,
    localAppID: String? = nil
  ) {
    self.app = app
    self.decision = decision
    self.catalog = catalog
    self.release = release
    self.install = install
    self.channels = channels
    self.localAppID = localAppID
  }

  /// Convenience initializer for local synthesis and tests.
  init(
    appName: String,
    bundleId: String?,
    installedVersion: String?,
    matchedAppId: String?,
    matchedAppName: String?,
    matchConfidence: Double?,
    decision: Decision,
    trackingState: TrackingState,
    localReasonCode: LocalReasonCode?,
    latestVersion: String?,
    latestVersionRaw: String?,
    latestReleaseId: String?,
    targetArchitecture: String? = nil,
    channel: String?,
    availableChannels: [String]?,
    homebrewCaskToken: String?,
    releasedAt: String?,
    staleSince: String?,
    iconUrl: String?,
    artifact: Artifact?,
    installStrategy: InstallStrategy?,
    installTrust: InstallTrust? = nil,
    localAppID: String? = nil
  ) {
    self.app = AppInfo(name: appName, bundleId: bundleId, installedVersion: installedVersion)
    self.decision = decision
    self.catalog = CatalogInfo(
      match: Match(appID: matchedAppId, appName: matchedAppName, confidence: matchConfidence),
      trackingState: trackingState,
      localReasonCode: localReasonCode,
      iconURL: iconUrl,
      staleSince: staleSince
    )
    self.release = ReleaseInfo(
      version: latestVersion,
      versionRaw: latestVersionRaw,
      releaseID: latestReleaseId,
      releasedAt: releasedAt,
      targetArchitecture: targetArchitecture,
      artifact: artifact
    )
    self.install = InstallInfo(
      strategy: installStrategy,
      trust: installTrust ?? InstallTrust.default(for: installStrategy),
      homebrewCaskToken: homebrewCaskToken
    )
    self.channels = ChannelInfo(selected: channel, available: availableChannels ?? [])
    self.localAppID = localAppID
  }

  private enum CodingKeys: String, CodingKey {
    case app, decision, catalog, release, install, channels
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    app = try container.decode(AppInfo.self, forKey: .app)
    decision = try container.decode(Decision.self, forKey: .decision)
    catalog = try container.decode(CatalogInfo.self, forKey: .catalog)
    release = try container.decode(ReleaseInfo.self, forKey: .release)
    install = try container.decode(InstallInfo.self, forKey: .install)
    channels = try container.decode(ChannelInfo.self, forKey: .channels)
    localAppID = nil
  }

  func encode(to encoder: Encoder) throws {
    var container = encoder.container(keyedBy: CodingKeys.self)
    try container.encode(app, forKey: .app)
    try container.encode(decision, forKey: .decision)
    try container.encode(catalog, forKey: .catalog)
    try container.encode(release, forKey: .release)
    try container.encode(install, forKey: .install)
    try container.encode(channels, forKey: .channels)
  }

  private static func makeID(
    appName: String,
    bundleId: String?,
    matchedAppId: String?,
    localAppID: String?
  ) -> String {
    if let localAppID, let bundleId {
      return "bundle:\(bundleId)|local:\(localAppID)"
    }

    if let localAppID {
      return "local:\(localAppID)"
    }

    if let bundleId {
      return "bundle:\(bundleId)"
    }

    if let matchedAppId {
      return "match:\(matchedAppId)|name:\(appName)"
    }

    return "name:\(appName)"
  }
}

extension InventoryResult {
  nonisolated var appName: String { app.name }
  nonisolated var bundleId: String? { app.bundleId }
  nonisolated var installedVersion: String? { app.installedVersion }
  nonisolated var matchedAppId: String? { catalog.match.appID }
  nonisolated var matchedAppName: String? { catalog.match.appName }
  nonisolated var matchConfidence: Double? { catalog.match.confidence }
  nonisolated var trackingState: TrackingState { catalog.trackingState }
  nonisolated var localReasonCode: LocalReasonCode? { catalog.localReasonCode }
  nonisolated var latestVersion: String? { release.version }
  nonisolated var latestVersionRaw: String? { release.versionRaw }
  nonisolated var latestReleaseId: String? { release.releaseID }
  nonisolated var targetArchitecture: String? { release.targetArchitecture }
  nonisolated var channel: String? { channels.selected }
  nonisolated var availableChannels: [String]? { channels.available.isEmpty ? nil : channels.available }
  nonisolated var homebrewCaskToken: String? { install.homebrewCaskToken }
  nonisolated var releasedAt: String? { release.releasedAt }
  nonisolated var staleSince: String? { catalog.staleSince }
  nonisolated var iconUrl: String? { catalog.iconURL }
  nonisolated var artifact: Artifact? { release.artifact }
  nonisolated var installStrategy: InstallStrategy? { install.strategy }
  nonisolated var installTrust: InstallTrust { install.trust }

  /// Whether this app has an installable update.
  nonisolated var canInstall: Bool {
    decision == .updateAvailable && installStrategy != nil
  }

  nonisolated var isVerified: Bool {
    trackingState == .catalog
  }

  nonisolated var isLocalOnly: Bool {
    trackingState == .localOnly
  }

  nonisolated var localOnlyStatusTitle: String {
    switch decision {
    case .updateAvailable:
      "Local Update Available"
    case .ambiguous:
      "Needs Review"
    case .upToDate, .localOnly:
      "Local Only"
    case .incompatible:
      "Not Compatible"
    }
  }

  nonisolated var localOnlyDescription: String {
    switch localReasonCode {
    case .noPublicIdentity:
      "Versioneer does not have a public catalog identity for this app yet."
    case .noApprovedSource:
      "Versioneer found this app, but it does not have an approved public update source yet."
    case .matchedDraft:
      "Versioneer matched this app to an internal draft entry that is still under review."
    case .ambiguousMatch:
      "Versioneer found multiple possible catalog matches and needs a reviewer to resolve them."
    case .notFound:
      "Versioneer is using local metadata because this app is not in the public catalog yet."
    case .noCompatibleRelease:
      "Versioneer found this app, but no compatible release is available for this Mac."
    case nil:
      "Versioneer is using local metadata because this app is not backed by a public catalog entry."
    }
  }

  nonisolated func binding(to installedApp: InstalledApp?) -> InventoryResult {
    InventoryResult(
      appName: appName,
      bundleId: bundleId,
      installedVersion: installedVersion,
      matchedAppId: matchedAppId,
      matchedAppName: matchedAppName,
      matchConfidence: matchConfidence,
      decision: decision,
      trackingState: trackingState,
      localReasonCode: localReasonCode,
      latestVersion: latestVersion,
      latestVersionRaw: latestVersionRaw,
      latestReleaseId: latestReleaseId,
      targetArchitecture: targetArchitecture,
      channel: channel,
      availableChannels: availableChannels,
      homebrewCaskToken: homebrewCaskToken,
      releasedAt: releasedAt,
      staleSince: staleSince,
      iconUrl: iconUrl,
      artifact: artifact,
      installStrategy: installStrategy,
      installTrust: installTrust,
      localAppID: installedApp?.id ?? localAppID
    )
  }

  /// Returns a copy with only the decision field changed.
  nonisolated func replacing(decision newDecision: Decision) -> InventoryResult {
    InventoryResult(
      appName: appName,
      bundleId: bundleId,
      installedVersion: installedVersion,
      matchedAppId: matchedAppId,
      matchedAppName: matchedAppName,
      matchConfidence: matchConfidence,
      decision: newDecision,
      trackingState: trackingState,
      localReasonCode: localReasonCode,
      latestVersion: latestVersion,
      latestVersionRaw: latestVersionRaw,
      latestReleaseId: latestReleaseId,
      targetArchitecture: targetArchitecture,
      channel: channel,
      availableChannels: availableChannels,
      homebrewCaskToken: homebrewCaskToken,
      releasedAt: releasedAt,
      staleSince: staleSince,
      iconUrl: iconUrl,
      artifact: artifact,
      installStrategy: installStrategy,
      installTrust: installTrust,
      localAppID: localAppID
    )
  }
}

/// Install strategy for an app, inferred from source type and artifact type.
enum InstallStrategy: String, Codable, Sendable, CaseIterable {
  case sparkle
  case zipReplace = "zip_replace"
  case dmgCopyReplace = "dmg_copy_replace"
  case pkgInstall = "pkg_install"
  case macAppStore = "mac_app_store"
  case manualOnly = "manual_only"

  /// Whether the app should be quit before installation.
  nonisolated var requiresQuit: Bool {
    switch self {
    case .sparkle, .macAppStore: false
    case .zipReplace, .dmgCopyReplace, .pkgInstall, .manualOnly: true
    }
  }

  /// Whether admin privileges are needed.
  nonisolated var requiresAdmin: Bool {
    self == .pkgInstall
  }
}
