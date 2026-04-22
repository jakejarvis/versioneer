import Foundation

/// A single backend decision about an installed app.
nonisolated struct AppDecision: Identifiable, Codable, Hashable, Sendable {
  let appName: String
  let bundleId: String?
  let installedVersion: String?
  let matchedAppId: String?
  let matchedAppName: String?
  let matchConfidence: Double?
  let decision: Decision
  let trackingState: TrackingState
  let localReasonCode: LocalReasonCode?
  let latestVersion: String?
  let latestVersionRaw: String?
  let latestReleaseId: String?
  let targetArchitecture: String?
  let channel: String?
  let availableChannels: [String]?
  let homebrewCaskToken: String?
  let releasedAt: String?
  let staleSince: String?
  let iconUrl: String?
  let artifact: Artifact?
  let installStrategy: InstallStrategy?
  let installTrust: InstallTrust
  let localAppID: String?

  var id: String {
    Self.makeID(
      appName: appName,
      bundleId: bundleId,
      matchedAppId: matchedAppId,
      localAppID: localAppID
    )
  }

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
    self.appName = appName
    self.bundleId = bundleId
    self.installedVersion = installedVersion
    self.matchedAppId = matchedAppId
    self.matchedAppName = matchedAppName
    self.matchConfidence = matchConfidence
    self.decision = decision
    self.trackingState = trackingState
    self.localReasonCode = localReasonCode
    self.latestVersion = latestVersion
    self.latestVersionRaw = latestVersionRaw
    self.latestReleaseId = latestReleaseId
    self.targetArchitecture = targetArchitecture
    self.channel = channel
    self.availableChannels = availableChannels
    self.homebrewCaskToken = homebrewCaskToken
    self.releasedAt = releasedAt
    self.staleSince = staleSince
    self.iconUrl = iconUrl
    self.artifact = artifact
    self.installStrategy = installStrategy
    self.installTrust = installTrust ?? InstallTrust.default(for: installStrategy)
    self.localAppID = localAppID
  }

  private enum CodingKeys: String, CodingKey {
    case appName, bundleId, installedVersion, matchedAppId, matchedAppName,
      matchConfidence, decision, trackingState, localReasonCode, latestVersion, latestVersionRaw,
      latestReleaseId, targetArchitecture, channel, availableChannels, homebrewCaskToken,
      releasedAt,
      staleSince, iconUrl,
      artifact, installStrategy, installTrust
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    appName = try container.decode(String.self, forKey: .appName)
    bundleId = try container.decodeIfPresent(String.self, forKey: .bundleId)
    installedVersion = try container.decodeIfPresent(String.self, forKey: .installedVersion)
    matchedAppId = try container.decodeIfPresent(String.self, forKey: .matchedAppId)
    matchedAppName = try container.decodeIfPresent(String.self, forKey: .matchedAppName)
    matchConfidence = try container.decodeIfPresent(Double.self, forKey: .matchConfidence)
    decision = try container.decode(Decision.self, forKey: .decision)
    trackingState = try container.decode(TrackingState.self, forKey: .trackingState)
    localReasonCode = try container.decodeIfPresent(LocalReasonCode.self, forKey: .localReasonCode)
    latestVersion = try container.decodeIfPresent(String.self, forKey: .latestVersion)
    latestVersionRaw = try container.decodeIfPresent(String.self, forKey: .latestVersionRaw)
    latestReleaseId = try container.decodeIfPresent(String.self, forKey: .latestReleaseId)
    targetArchitecture = try container.decodeIfPresent(String.self, forKey: .targetArchitecture)
    channel = try container.decodeIfPresent(String.self, forKey: .channel)
    availableChannels = try container.decodeIfPresent([String].self, forKey: .availableChannels)
    homebrewCaskToken = try container.decodeIfPresent(String.self, forKey: .homebrewCaskToken)
    releasedAt = try container.decodeIfPresent(String.self, forKey: .releasedAt)
    staleSince = try container.decodeIfPresent(String.self, forKey: .staleSince)
    iconUrl = try container.decodeIfPresent(String.self, forKey: .iconUrl)
    artifact = try container.decodeIfPresent(Artifact.self, forKey: .artifact)
    installStrategy = try container.decodeIfPresent(InstallStrategy.self, forKey: .installStrategy)
    installTrust =
      try container.decodeIfPresent(InstallTrust.self, forKey: .installTrust)
      ?? InstallTrust.default(for: installStrategy)
    localAppID = nil
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
    }

    static func `default`(for installStrategy: InstallStrategy?) -> InstallTrust {
      if let installStrategy {
        return InstallTrust(status: .oneClick, resolvedStrategy: installStrategy, reasons: [])
      }
      return InstallTrust(status: .none, resolvedStrategy: nil, reasons: [])
    }
  }

  /// Whether this app has an installable update.
  var canInstall: Bool {
    decision == .updateAvailable && installStrategy != nil
  }

  var isVerified: Bool {
    trackingState == .catalog
  }

  var isLocalOnly: Bool {
    trackingState == .localOnly
  }

  var localOnlyStatusTitle: String {
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

  var localOnlyDescription: String {
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

  func binding(to installedApp: InstalledApp?) -> AppDecision {
    AppDecision(
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
  func replacing(decision newDecision: Decision) -> AppDecision {
    AppDecision(
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
