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
  let latestVersion: String?
  let latestVersionRaw: String?
  let latestReleaseId: String?
  let homebrewCaskToken: String?
  let releasedAt: String?
  let iconUrl: String?
  let artifact: Artifact?
  let install: Install

  init(
    appName: String,
    bundleId: String?,
    installedVersion: String?,
    matchedAppId: String?,
    matchedAppName: String?,
    matchConfidence: Double?,
    decision: Decision,
    latestVersion: String?,
    latestVersionRaw: String?,
    latestReleaseId: String?,
    homebrewCaskToken: String?,
    releasedAt: String?,
    iconUrl: String?,
    artifact: Artifact?,
    install: Install
  ) {
    self.id = appName + (bundleId ?? "")
    self.appName = appName
    self.bundleId = bundleId
    self.installedVersion = installedVersion
    self.matchedAppId = matchedAppId
    self.matchedAppName = matchedAppName
    self.matchConfidence = matchConfidence
    self.decision = decision
    self.latestVersion = latestVersion
    self.latestVersionRaw = latestVersionRaw
    self.latestReleaseId = latestReleaseId
    self.homebrewCaskToken = homebrewCaskToken
    self.releasedAt = releasedAt
    self.iconUrl = iconUrl
    self.artifact = artifact
    self.install = install
  }

  private enum CodingKeys: String, CodingKey {
    case appName, bundleId, installedVersion, matchedAppId, matchedAppName,
      matchConfidence, decision, latestVersion, latestVersionRaw, latestReleaseId,
      homebrewCaskToken, releasedAt, iconUrl, artifact, install
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
    latestVersion = try container.decodeIfPresent(String.self, forKey: .latestVersion)
    latestVersionRaw = try container.decodeIfPresent(String.self, forKey: .latestVersionRaw)
    latestReleaseId = try container.decodeIfPresent(String.self, forKey: .latestReleaseId)
    homebrewCaskToken = try container.decodeIfPresent(String.self, forKey: .homebrewCaskToken)
    releasedAt = try container.decodeIfPresent(String.self, forKey: .releasedAt)
    iconUrl = try container.decodeIfPresent(String.self, forKey: .iconUrl)
    artifact = try container.decodeIfPresent(Artifact.self, forKey: .artifact)
    install = try container.decode(Install.self, forKey: .install)
  }

  enum Decision: String, Codable, Sendable, CaseIterable {
    case unknown
    case upToDate = "up_to_date"
    case updateAvailable = "update_available"
    case ambiguous
    case unsupported
    case ignored
  }

  struct Artifact: Codable, Hashable, Sendable {
    let id: String?
    let downloadUrl: String?
    let architecture: String?
    let minOsVersion: String?
    let artifactType: String?
    let sizeBytes: Int?
    let sha256: String?
    let expectedTeamId: String?
    let expectedBundleId: String?
    let expectedVersionRaw: String?
  }

  struct Install: Codable, Hashable, Sendable {
    let canInstall: Bool
    let installabilityClass: InstallabilityClass?
    let strategy: Strategy?
    let requiresQuit: Bool
    let requiresAdmin: Bool
    let supportsSilent: Bool
    let eligibility: Eligibility

    enum Strategy: String, Codable, Sendable, CaseIterable {
      case sparkle
      case zipReplace = "zip_replace"
      case dmgCopyReplace = "dmg_copy_replace"
      case pkgInstall = "pkg_install"
      case pkgManual = "pkg_manual"
      case manualOnly = "manual_only"
    }

    enum Eligibility: String, Codable, Sendable, CaseIterable {
      case eligible
      case requiresWarning = "requires_warning"
      case notSupported = "not_supported"
      case manualOnly = "manual_only"
      case masApp = "mas_app"
    }

    enum InstallabilityClass: String, Codable, Sendable, CaseIterable {
      case notifyOnly = "notify_only"
      case assistedDownload = "assisted_download"
      case assistedReplace = "assisted_replace"
      case automationCandidate = "automation_candidate"
    }

    static let unavailable = Install(
      canInstall: false,
      installabilityClass: nil,
      strategy: nil,
      requiresQuit: false,
      requiresAdmin: false,
      supportsSilent: false,
      eligibility: .notSupported
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
      latestVersion: latestVersion,
      latestVersionRaw: latestVersionRaw,
      latestReleaseId: latestReleaseId,
      homebrewCaskToken: homebrewCaskToken,
      releasedAt: releasedAt,
      iconUrl: iconUrl,
      artifact: artifact,
      install: install
    )
  }
}
