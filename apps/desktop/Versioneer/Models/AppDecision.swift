import Foundation

/// A single backend decision about an installed app.
nonisolated struct AppDecision: Identifiable, Codable, Hashable, Sendable {
  let id: String
  let appName: String
  let bundleId: String?
  let installedVersion: String?
  let matchedAppId: String?
  let matchedAppName: String?
  let matchConfidence: Double?
  let decision: Decision
  let isVerified: Bool
  let latestVersion: String?
  let latestVersionRaw: String?
  let latestReleaseId: String?
  let channel: String?
  let availableChannels: [String]?
  let homebrewCaskToken: String?
  let releasedAt: String?
  let staleSince: String?
  let iconUrl: String?
  let artifact: Artifact?
  let installStrategy: InstallStrategy?

  init(
    appName: String,
    bundleId: String?,
    installedVersion: String?,
    matchedAppId: String?,
    matchedAppName: String?,
    matchConfidence: Double?,
    decision: Decision,
    isVerified: Bool,
    latestVersion: String?,
    latestVersionRaw: String?,
    latestReleaseId: String?,
    channel: String?,
    availableChannels: [String]?,
    homebrewCaskToken: String?,
    releasedAt: String?,
    staleSince: String?,
    iconUrl: String?,
    artifact: Artifact?,
    installStrategy: InstallStrategy?
  ) {
    self.id = appName + (bundleId ?? "")
    self.appName = appName
    self.bundleId = bundleId
    self.installedVersion = installedVersion
    self.matchedAppId = matchedAppId
    self.matchedAppName = matchedAppName
    self.matchConfidence = matchConfidence
    self.decision = decision
    self.isVerified = isVerified
    self.latestVersion = latestVersion
    self.latestVersionRaw = latestVersionRaw
    self.latestReleaseId = latestReleaseId
    self.channel = channel
    self.availableChannels = availableChannels
    self.homebrewCaskToken = homebrewCaskToken
    self.releasedAt = releasedAt
    self.staleSince = staleSince
    self.iconUrl = iconUrl
    self.artifact = artifact
    self.installStrategy = installStrategy
  }

  private enum CodingKeys: String, CodingKey {
    case appName, bundleId, installedVersion, matchedAppId, matchedAppName,
      matchConfidence, decision, isVerified, latestVersion, latestVersionRaw,
      latestReleaseId, channel, availableChannels, homebrewCaskToken, releasedAt, staleSince, iconUrl,
      artifact, installStrategy
  }

  init(from decoder: Decoder) throws {
    let container = try decoder.container(keyedBy: CodingKeys.self)
    appName = try container.decode(String.self, forKey: .appName)
    bundleId = try container.decodeIfPresent(String.self, forKey: .bundleId)
    id = appName + (bundleId ?? "")
    installedVersion = try container.decodeIfPresent(String.self, forKey: .installedVersion)
    matchedAppId = try container.decodeIfPresent(String.self, forKey: .matchedAppId)
    matchedAppName = try container.decodeIfPresent(String.self, forKey: .matchedAppName)
    matchConfidence = try container.decodeIfPresent(Double.self, forKey: .matchConfidence)
    decision = try container.decode(Decision.self, forKey: .decision)
    isVerified = try container.decode(Bool.self, forKey: .isVerified)
    latestVersion = try container.decodeIfPresent(String.self, forKey: .latestVersion)
    latestVersionRaw = try container.decodeIfPresent(String.self, forKey: .latestVersionRaw)
    latestReleaseId = try container.decodeIfPresent(String.self, forKey: .latestReleaseId)
    channel = try container.decodeIfPresent(String.self, forKey: .channel)
    availableChannels = try container.decodeIfPresent([String].self, forKey: .availableChannels)
    homebrewCaskToken = try container.decodeIfPresent(String.self, forKey: .homebrewCaskToken)
    releasedAt = try container.decodeIfPresent(String.self, forKey: .releasedAt)
    staleSince = try container.decodeIfPresent(String.self, forKey: .staleSince)
    iconUrl = try container.decodeIfPresent(String.self, forKey: .iconUrl)
    artifact = try container.decodeIfPresent(Artifact.self, forKey: .artifact)
    installStrategy = try container.decodeIfPresent(InstallStrategy.self, forKey: .installStrategy)
  }

  enum Decision: String, Codable, Sendable, CaseIterable {
    case upToDate = "up_to_date"
    case updateAvailable = "update_available"
    case ambiguous
    case notTracked = "not_tracked"
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

  /// Whether this app has an installable update.
  var canInstall: Bool {
    decision == .updateAvailable && installStrategy != nil
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
      isVerified: isVerified,
      latestVersion: latestVersion,
      latestVersionRaw: latestVersionRaw,
      latestReleaseId: latestReleaseId,
      channel: channel,
      availableChannels: availableChannels,
      homebrewCaskToken: homebrewCaskToken,
      releasedAt: releasedAt,
      staleSince: staleSince,
      iconUrl: iconUrl,
      artifact: artifact,
      installStrategy: installStrategy
    )
  }
}

/// Install strategy for an app, inferred from source type and artifact type.
enum InstallStrategy: String, Codable, Sendable, CaseIterable {
  case sparkle
  case zipReplace = "zip_replace"
  case dmgCopyReplace = "dmg_copy_replace"
  case pkgInstall = "pkg_install"
  case manualOnly = "manual_only"

  /// Whether the app should be quit before installation.
  nonisolated var requiresQuit: Bool {
    switch self {
    case .sparkle: false
    case .zipReplace, .dmgCopyReplace, .pkgInstall, .manualOnly: true
    }
  }

  /// Whether admin privileges are needed.
  nonisolated var requiresAdmin: Bool {
    self == .pkgInstall
  }
}
