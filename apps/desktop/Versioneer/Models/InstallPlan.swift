import Foundation

/// Resolved install plan derived from an InventoryResult.
/// Catalog-backed installs map onto persisted install executions.
nonisolated struct InstallPlan: Sendable, Equatable {
  nonisolated enum Origin: Sendable, Equatable {
    case catalog(appId: String, releaseId: String, channel: String?, targetArchitecture: String?)
    case local
  }

  let localId: String
  let strategy: InstallStrategy
  let origin: Origin
  let artifact: InventoryResult.Artifact?

  init(
    localId: String = UUID().uuidString,
    strategy: InstallStrategy,
    origin: Origin,
    artifact: InventoryResult.Artifact? = nil
  ) {
    self.localId = localId
    self.strategy = strategy
    self.origin = origin
    self.artifact = artifact
  }

  init(
    localId: String = UUID().uuidString,
    strategy: InstallStrategy,
    appId: String,
    releaseId: String,
    channel: String? = nil,
    targetArchitecture: String? = nil,
    artifact: InventoryResult.Artifact? = nil
  ) {
    self.init(
      localId: localId,
      strategy: strategy,
      origin: .catalog(
        appId: appId,
        releaseId: releaseId,
        channel: channel,
        targetArchitecture: targetArchitecture
      ),
      artifact: artifact
    )
  }

  var appId: String? {
    guard case .catalog(let appId, _, _, _) = origin else { return nil }
    return appId
  }

  var releaseId: String? {
    guard case .catalog(_, let releaseId, _, _) = origin else { return nil }
    return releaseId
  }

  var channel: String? {
    guard case .catalog(_, _, let channel, _) = origin else { return nil }
    return channel
  }

  var targetArchitecture: String? {
    guard case .catalog(_, _, _, let targetArchitecture) = origin else { return nil }
    return targetArchitecture
  }

  var isCatalogBacked: Bool {
    if case .catalog = origin {
      return true
    }
    return false
  }

  init?(result: InventoryResult, installedApp: InstalledApp?) {
    guard result.decision == .updateAvailable,
      let strategy = result.installStrategy
    else { return nil }

    if let appId = result.matchedAppId,
      let releaseId = result.latestReleaseId
    {
      self.init(
        strategy: strategy,
        origin: .catalog(
          appId: appId,
          releaseId: releaseId,
          channel: result.channel,
          targetArchitecture: result.targetArchitecture
        ),
        artifact: result.artifact
      )
      return
    }

    guard result.isLocalOnly else { return nil }

    switch strategy {
    case .sparkle:
      self.init(strategy: strategy, origin: .local, artifact: result.artifact)
    case .zipReplace, .dmgCopyReplace, .pkgInstall:
      guard result.artifact?.downloadUrl != nil else { return nil }
      let hasIdentityAnchor = installedApp?.bundleId != nil || installedApp?.teamId != nil
      guard hasIdentityAnchor else { return nil }
      self.init(strategy: strategy, origin: .local, artifact: result.artifact)
    case .macAppStore, .manualOnly:
      return nil
    }
  }
}
