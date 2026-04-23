import Foundation

@MainActor
extension AppState {
  enum LocalUpdateSourceKind: Int {
    case versionOnly
    case electron
    case sparkle
    case homebrew
    case appStore
  }

  /// Unified local update info from any checker (Sparkle, Electron, MAS, Homebrew).
  struct LocalUpdateCandidate {
    let sourceKind: LocalUpdateSourceKind
    let latestVersion: String?
    let publishedAt: String?
    let artifact: AppDecision.Artifact?
    let installStrategy: InstallStrategy?
    let updateDetected: Bool
  }

  /// Combines Sparkle, Electron, MAS, and Homebrew results into a single lookup by local app ID.
  func buildLocalUpdateMap(
    sparkle: [String: SparkleChecker.SparkleResult],
    electron: [String: ElectronChecker.ElectronResult],
    appStore: [String: AppStoreChecker.AppStoreResult],
    homebrew: [String: HomebrewChecker.HomebrewResult],
    apps: [InstalledApp]
  ) -> [String: LocalUpdateCandidate] {
    var map: [String: LocalUpdateCandidate] = [:]

    for app in apps {
      let candidates = localUpdateCandidates(
        for: app,
        sparkle: sparkle[app.localID],
        electron: electron[app.localID],
        appStore: appStore[app.localID],
        homebrew: homebrew[app.localID]
      )
      if let preferred = preferredLocalUpdateCandidate(from: candidates) {
        map[app.localID] = preferred
      }
    }

    return map
  }

  /// Merges backend decisions with local check results.
  /// Backend takes precedence for matched apps; local results fill in unknown/unmatched apps.
  /// MAS apps with unknown decisions are marked as ignored.
  func mergeResults(
    backend: [AppDecision],
    local: [String: LocalUpdateCandidate],
    apps: [InstalledApp]
  ) -> [AppDecision] {
    var results = bindInstalledApps(to: backend, apps: apps)

    for (index, decision) in results.enumerated() {
      let matchingApp = findInstalledApp(for: decision, in: apps)

      guard decision.isLocalOnly else { continue }
      guard let matchingApp, let localInfo = local[matchingApp.localID] else { continue }

      results[index] = AppDecision(
        appName: decision.appName,
        bundleId: decision.bundleId,
        installedVersion: decision.installedVersion,
        matchedAppId: decision.matchedAppId,
        matchedAppName: decision.matchedAppName,
        matchConfidence: decision.matchConfidence,
        decision: localDecision(for: localInfo, installedVersion: decision.installedVersion),
        trackingState: decision.trackingState,
        localReasonCode: decision.localReasonCode,
        latestVersion: localInfo.latestVersion ?? decision.latestVersion,
        latestVersionRaw: localInfo.latestVersion ?? decision.latestVersionRaw,
        latestReleaseId: decision.latestReleaseId,
        targetArchitecture: decision.targetArchitecture,
        channel: decision.channel,
        availableChannels: decision.availableChannels,
        homebrewCaskToken: matchingApp.homebrewCaskToken ?? decision.homebrewCaskToken,
        releasedAt: localInfo.publishedAt ?? decision.releasedAt,
        staleSince: decision.staleSince,
        iconUrl: decision.iconUrl,
        artifact: localInfo.artifact ?? decision.artifact,
        installStrategy: localInfo.installStrategy ?? decision.installStrategy,
        localAppID: decision.localAppID
      )
    }

    return results
  }

  /// Builds AppDecision entries from local results when the backend is unavailable.
  func buildLocalOnlyResults(
    local: [String: LocalUpdateCandidate],
    apps: [InstalledApp]
  ) -> [AppDecision] {
    apps.map { app in
      let decision: AppDecision.Decision
      let latestVersion: String?
      let releasedAt: String?
      let artifact: AppDecision.Artifact?
      let installStrategy: InstallStrategy?

      if let info = local[app.localID] {
        decision = localDecision(for: info, installedVersion: app.version)
        latestVersion = info.latestVersion
        releasedAt = info.publishedAt
        artifact = info.artifact
        installStrategy = info.installStrategy
      } else {
        decision = .localOnly
        latestVersion = nil
        releasedAt = nil
        artifact = nil
        installStrategy = nil
      }

      return AppDecision(
        appName: app.name,
        bundleId: app.bundleId,
        installedVersion: app.version,
        matchedAppId: nil,
        matchedAppName: nil,
        matchConfidence: nil,
        decision: decision,
        trackingState: .localOnly,
        localReasonCode: nil,
        latestVersion: latestVersion,
        latestVersionRaw: latestVersion,
        latestReleaseId: nil,
        channel: nil,
        availableChannels: nil,
        homebrewCaskToken: app.homebrewCaskToken,
        releasedAt: releasedAt,
        staleSince: nil,
        iconUrl: nil,
        artifact: artifact,
        installStrategy: installStrategy,
        localAppID: app.localID
      )
    }
  }

  private func localUpdateCandidates(
    for app: InstalledApp,
    sparkle: SparkleChecker.SparkleResult?,
    electron: ElectronChecker.ElectronResult?,
    appStore: AppStoreChecker.AppStoreResult?,
    homebrew: HomebrewChecker.HomebrewResult?
  ) -> [LocalUpdateCandidate] {
    var candidates: [LocalUpdateCandidate] = []

    if let appStore, app.isMasApp {
      candidates.append(
        LocalUpdateCandidate(
          sourceKind: .appStore,
          latestVersion: appStore.latestVersion,
          publishedAt: appStore.releaseDate,
          artifact: nil,
          installStrategy: nil,
          updateDetected: false
        )
      )
    }

    if let homebrew {
      candidates.append(
        LocalUpdateCandidate(
          sourceKind: .homebrew,
          latestVersion: homebrew.latestVersion,
          publishedAt: nil,
          artifact: nil,
          installStrategy: nil,
          updateDetected: homebrew.updateDetected
        )
      )
    }

    if let sparkle {
      candidates.append(
        LocalUpdateCandidate(
          sourceKind: .sparkle,
          latestVersion: sparkle.latestVersion,
          publishedAt: sparkle.publishedAt,
          artifact: artifactFromDownloadURL(
            sparkle.downloadUrl,
            minOsVersion: sparkle.minOsVersion
          ),
          installStrategy: .sparkle,
          updateDetected: false
        )
      )
    }

    if let electron {
      let artifact = artifactFromDownloadURL(electron.downloadUrl, minOsVersion: nil)
      let directInstall = directInstallDetails(
        downloadUrl: electron.downloadUrl,
        minOsVersion: nil,
        installedApp: app
      )
      candidates.append(
        LocalUpdateCandidate(
          sourceKind: .electron,
          latestVersion: electron.latestVersion,
          publishedAt: electron.publishedAt,
          artifact: directInstall?.artifact ?? artifact,
          installStrategy: directInstall?.strategy,
          updateDetected: false
        )
      )
    }

    return candidates.filter {
      $0.latestVersion != nil || $0.updateDetected || $0.installStrategy != nil
    }
  }

  private func preferredLocalUpdateCandidate(
    from candidates: [LocalUpdateCandidate]
  ) -> LocalUpdateCandidate? {
    candidates.max { lhs, rhs in
      if lhs.sourceKind.rawValue != rhs.sourceKind.rawValue {
        return lhs.sourceKind.rawValue < rhs.sourceKind.rawValue
      }

      let lhsIsInstallable = lhs.installStrategy != nil
      let rhsIsInstallable = rhs.installStrategy != nil
      if lhsIsInstallable != rhsIsInstallable {
        return !lhsIsInstallable && rhsIsInstallable
      }

      let lhsHasVersion = lhs.latestVersion != nil
      let rhsHasVersion = rhs.latestVersion != nil
      if lhsHasVersion != rhsHasVersion {
        return !lhsHasVersion && rhsHasVersion
      }

      return false
    }
  }

  private func localDecision(
    for candidate: LocalUpdateCandidate,
    installedVersion: String?
  ) -> AppDecision.Decision {
    if candidate.updateDetected {
      return .updateAvailable
    }
    return decisionFromVersion(latest: candidate.latestVersion, installed: installedVersion)
  }

  private func directInstallDetails(
    downloadUrl: String?,
    minOsVersion: String?,
    installedApp: InstalledApp
  ) -> (strategy: InstallStrategy, artifact: AppDecision.Artifact)? {
    guard let strategy = supportedDirectInstallStrategy(for: downloadUrl) else { return nil }
    guard installedApp.bundleId != nil || installedApp.teamId != nil else { return nil }
    guard let artifact = artifactFromDownloadURL(downloadUrl, minOsVersion: minOsVersion) else {
      return nil
    }
    return (strategy, artifact)
  }

  private func artifactFromDownloadURL(
    _ downloadUrl: String?,
    minOsVersion: String?
  ) -> AppDecision.Artifact? {
    guard let downloadUrl,
      let artifactType = artifactType(for: downloadUrl)
    else { return nil }

    return AppDecision.Artifact(
      id: nil,
      downloadUrl: downloadUrl,
      architecture: nil,
      minOsVersion: minOsVersion,
      artifactType: artifactType,
      sizeBytes: nil,
      sha256: nil
    )
  }

  private func supportedDirectInstallStrategy(for downloadUrl: String?) -> InstallStrategy? {
    guard let artifactType = downloadUrl.flatMap(artifactType(for:)) else { return nil }
    switch artifactType {
    case "zip":
      return .zipReplace
    case "dmg":
      return .dmgCopyReplace
    case "pkg":
      return .pkgInstall
    default:
      return nil
    }
  }

  private func artifactType(for downloadUrl: String) -> String? {
    let pathExtension =
      (URL(string: downloadUrl)?.pathExtension ?? (downloadUrl as NSString).pathExtension)
      .lowercased()
    guard ["zip", "dmg", "pkg"].contains(pathExtension) else { return nil }
    return pathExtension
  }

  func bindInstalledApps(
    to decisions: [AppDecision],
    apps: [InstalledApp]
  ) -> [AppDecision] {
    var remainingAppIDs = Set(apps.map(\.id))
    let appsByID = Dictionary(uniqueKeysWithValues: apps.map { ($0.id, $0) })
    let appsByBundleId = Dictionary(
      grouping: apps.compactMap { app in
        app.bundleId.map { ($0, app) }
      }
    ) { $0.0 }
    .mapValues { pairs in pairs.map(\.1) }
    let appsByName = Dictionary(grouping: apps) { $0.name }

    func claimFirstMatching(from candidates: [InstalledApp]) -> InstalledApp? {
      for candidate in candidates.sorted(by: { lhs, rhs in
        lhs.path.localizedStandardCompare(rhs.path) == .orderedAscending
      }) where remainingAppIDs.contains(candidate.id) {
        remainingAppIDs.remove(candidate.id)
        return candidate
      }
      return nil
    }

    return decisions.map { decision in
      if let localAppID = decision.localAppID,
        let installedApp = appsByID[localAppID]
      {
        remainingAppIDs.remove(installedApp.id)
        return decision.binding(to: installedApp)
      }

      if let bundleId = decision.bundleId,
        let installedApp = claimFirstMatching(from: appsByBundleId[bundleId] ?? [])
      {
        return decision.binding(to: installedApp)
      }

      let nameCandidates = appsByName[decision.appName] ?? []
      if let installedVersion = decision.installedVersion,
        let installedApp = claimFirstMatching(
          from: nameCandidates.filter { $0.version == installedVersion })
      {
        return decision.binding(to: installedApp)
      }

      if let installedApp = claimFirstMatching(from: nameCandidates) {
        return decision.binding(to: installedApp)
      }

      return decision
    }
  }

  private func findInstalledApp(for decision: AppDecision, in apps: [InstalledApp]) -> InstalledApp?
  {
    if let localAppID = decision.localAppID {
      return apps.first { $0.id == localAppID }
    }

    if let bundleId = decision.bundleId {
      return apps.first { $0.bundleId == bundleId }
    }

    let nameMatches = apps.filter { $0.name == decision.appName }
    if let installedVersion = decision.installedVersion,
      let exactVersionMatch = nameMatches.first(where: { $0.version == installedVersion })
    {
      return exactVersionMatch
    }

    guard nameMatches.count == 1 else { return nil }
    return nameMatches[0]
  }

  private func decisionFromVersion(latest: String?, installed: String?) -> AppDecision.Decision {
    guard let latest, let installed else { return .localOnly }
    if latest == installed { return .upToDate }
    if compareVersionStrings(latest, isNewerThan: installed) {
      return .updateAvailable
    }
    return .upToDate
  }

  private func compareVersionStrings(_ a: String, isNewerThan b: String) -> Bool {
    Version(a) > Version(b)
  }
}
