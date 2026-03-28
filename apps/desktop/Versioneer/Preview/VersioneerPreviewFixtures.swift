#if DEBUG
  import SwiftUI

  enum VersioneerPreviewFixtures {
    static let firefox = makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      installedVersion: "126.0",
      matchedAppId: "app_firefox",
      matchedAppName: "Mozilla Firefox",
      matchConfidence: 98,
      decision: .updateAvailable,
      isVerified: true,
      latestVersion: "127.0",
      latestVersionRaw: "127.0",
      releasedAt: isoString(daysAgo: 3),
      artifact: .init(
        id: "artifact_firefox",
        downloadUrl: "https://example.com/firefox.zip",
        architecture: "universal",
        minOsVersion: "13.0",
        artifactType: "zip",
        sizeBytes: 182_452_384,
        sha256: "abc123"
      ),
      installStrategy: .zipReplace
    )

    static let obs = makeDecision(
      appName: "OBS Studio",
      bundleId: "com.obsproject.obs-studio",
      installedVersion: "30.1.0",
      matchedAppId: "app_obs",
      matchedAppName: "OBS Studio",
      matchConfidence: 84,
      decision: .updateAvailable,
      isVerified: false,
      latestVersion: "30.2.0",
      latestVersionRaw: "30.2.0",
      releasedAt: isoString(daysAgo: 7),
      artifact: .init(
        id: "artifact_obs",
        downloadUrl: "https://example.com/obs.dmg",
        architecture: "universal",
        minOsVersion: "13.0",
        artifactType: "dmg",
        sizeBytes: 231_000_000,
        sha256: nil
      ),
      installStrategy: .dmgCopyReplace
    )

    static let textMate = makeDecision(
      appName: "TextMate",
      bundleId: "com.macromates.TextMate",
      installedVersion: "2.0.23",
      matchedAppId: "app_textmate",
      matchedAppName: "TextMate",
      matchConfidence: 99,
      decision: .updateAvailable,
      isVerified: true,
      latestVersion: "2.0.24",
      latestVersionRaw: "2.0.24",
      releasedAt: isoString(daysAgo: 1),
      artifact: .init(
        id: "artifact_textmate",
        downloadUrl: "https://example.com/textmate.pkg",
        architecture: "universal",
        minOsVersion: "14.0",
        artifactType: "pkg",
        sizeBytes: 46_000_000,
        sha256: "def456"
      ),
      installStrategy: .pkgInstall
    )

    static let arc = makeDecision(
      appName: "Arc",
      bundleId: "company.thebrowser.Browser",
      installedVersion: "1.84.0",
      matchedAppId: "app_arc",
      matchedAppName: "Arc",
      matchConfidence: 99,
      decision: .upToDate,
      isVerified: true,
      latestVersion: "1.84.0",
      latestVersionRaw: "1.84.0",
      releasedAt: isoString(daysAgo: 14),
      artifact: nil,
      installStrategy: nil
    )

    static let allResults = [firefox, obs, textMate, arc]

    static func rootState(
      results: [AppDecision] = allResults,
      detailResultID: String? = nil,
      loadState: AppState.LoadState = .done,
      installStates: [(AppDecision, InstallCoordinator.OperationState)] = [],
      ignoredRules: [IgnoredAppRule] = []
    ) -> AppState {
      let suiteName = "com.jakejarvis.versioneer.preview.\(UUID().uuidString)"
      let defaults = UserDefaults(suiteName: suiteName)!
      defaults.removePersistentDomain(forName: suiteName)
      let settings = SettingsStore(defaults: defaults)
      settings.ignoredAppRules = ignoredRules
      let cacheURL = FileManager.default.temporaryDirectory
        .appendingPathComponent(UUID().uuidString, isDirectory: true)
        .appendingPathComponent("ScanCache.json")
      let state = AppState(
        settings: settings,
        cacheStore: ScanCacheStore(fileURLOverride: cacheURL)
      )
      state.installedApps = results.map(makeInstalledApp)
      state.rawInventoryResults = results
      state.inventoryResults = results
      state.refreshDisplayedResults()
      state.snapshotId = "preview_snapshot"
      state.loadState = loadState
      state.lastScanCompletedAt = Date().addingTimeInterval(-900)
      state.selectedSection = .all
      state.resultsSort = .updatesFirst
      state.searchText = ""

      if let detailResultID {
        state.openDetail(id: detailResultID)
      }

      for (result, operationState) in installStates {
        state.installCoordinator.previewSetState(operationState, for: result)
      }

      return state
    }

    static func installState(
      appDisplayName: String,
      phase: InstallCoordinator.Phase,
      detail: String,
      executionId: String = "exec_preview",
      errorMessage: String? = nil,
      installedVersion: String? = nil,
      recoveryAction: InstallCoordinator.RecoveryAction? = nil,
      helperStatus: InstallCoordinator.HelperSetupState? = nil
    ) -> InstallCoordinator.OperationState {
      InstallCoordinator.OperationState(
        appDisplayName: appDisplayName,
        phase: phase,
        detail: detail,
        executionId: executionId,
        errorMessage: errorMessage,
        installedVersion: installedVersion,
        recoveryAction: recoveryAction,
        helperStatus: helperStatus
      )
    }

    private static func makeDecision(
      appName: String,
      bundleId: String,
      installedVersion: String,
      matchedAppId: String,
      matchedAppName: String,
      matchConfidence: Double,
      decision: AppDecision.Decision,
      isVerified: Bool,
      latestVersion: String,
      latestVersionRaw: String,
      releasedAt: String,
      artifact: AppDecision.Artifact?,
      installStrategy: InstallStrategy?
    ) -> AppDecision {
      AppDecision(
        appName: appName,
        bundleId: bundleId,
        installedVersion: installedVersion,
        matchedAppId: matchedAppId,
        matchedAppName: matchedAppName,
        matchConfidence: matchConfidence,
        decision: decision,
        isVerified: isVerified,
        latestVersion: latestVersion,
        latestVersionRaw: latestVersionRaw,
        latestReleaseId: nil,
        channel: nil,
        availableChannels: nil,
        homebrewCaskToken: nil,
        releasedAt: releasedAt,
        staleSince: nil,
        iconUrl: nil,
        artifact: artifact,
        installStrategy: installStrategy
      )
    }

    static func makeInstalledApp(from result: AppDecision) -> InstalledApp {
      InstalledApp(
        name: result.matchedAppName ?? result.appName,
        bundleId: result.bundleId,
        version: result.installedVersion,
        buildNumber: nil,
        teamId: nil,
        path: "/Applications/\(result.appName).app",
        architecture: result.artifact?.architecture,
        sparkleFeedUrl: nil,
        sparklePublicKey: nil,
        isSparkleApp: false,
        isMasApp: false,
        isElectronApp: false,
        electronUpdateProvider: nil,
        electronUpdateUrl: nil,
        codeSigningAuthority: nil,
        appCategory: nil,
        minMacOSVersion: nil,
        isHomebrewInstalled: false,
        homebrewCaskToken: nil
      )
    }

    private static func isoString(daysAgo: Int) -> String {
      let formatter = ISO8601DateFormatter()
      formatter.formatOptions = [.withInternetDateTime]
      return formatter.string(
        from: Calendar.current.date(byAdding: .day, value: -daysAgo, to: .now) ?? .now)
    }
  }

  private struct PreviewHost<Content: View>: View {
    let appState: AppState
    @ViewBuilder let content: Content

    init(appState: AppState, @ViewBuilder content: () -> Content) {
      self.appState = appState
      self.content = content()
    }

    var body: some View {
      content
        .environment(appState)
        .environment(appState.installCoordinator)
    }
  }

  private struct SettingsPreviewHost: View {
    let appState: AppState
    @State private var selfUpdateService = SelfUpdateService()

    var body: some View {
      SettingsView()
        .environment(appState)
        .environment(appState.installCoordinator)
        .environment(selfUpdateService)
    }
  }

  #Preview("Main Window") {
    PreviewHost(appState: VersioneerPreviewFixtures.rootState()) {
      RootView()
    }
  }

  #Preview("No Results") {
    PreviewHost(appState: VersioneerPreviewFixtures.rootState(results: [])) {
      RootView()
    }
  }

  #Preview("Detail: Update Available") {
    PreviewHost(
      appState: VersioneerPreviewFixtures.rootState(
        detailResultID: VersioneerPreviewFixtures.firefox.id)
    ) {
      RootView()
    }
  }

  #Preview("Detail: Install In Progress") {
    PreviewHost(
      appState: VersioneerPreviewFixtures.rootState(
        detailResultID: VersioneerPreviewFixtures.firefox.id,
        installStates: [
          (
            VersioneerPreviewFixtures.firefox,
            VersioneerPreviewFixtures.installState(
              appDisplayName: "Mozilla Firefox",
              phase: .verifying,
              detail: "Checking code signature and notarization…"
            )
          )
        ]
      )
    ) {
      RootView()
    }
  }

  #Preview("Detail: Install Failed") {
    PreviewHost(
      appState: VersioneerPreviewFixtures.rootState(
        detailResultID: VersioneerPreviewFixtures.textMate.id,
        installStates: [
          (
            VersioneerPreviewFixtures.textMate,
            VersioneerPreviewFixtures.installState(
              appDisplayName: "TextMate",
              phase: .failed,
              detail: "Install failed.",
              errorMessage: "Approve the helper in System Settings, then retry the install.",
              recoveryAction: .openSystemSettings,
              helperStatus: .approvalRequired
            )
          )
        ]
      )
    ) {
      RootView()
    }
  }

  #Preview("Main Window: Ignored") {
    PreviewHost(
      appState: VersioneerPreviewFixtures.rootState(
        ignoredRules: [
          IgnoredAppRule.make(
            from: VersioneerPreviewFixtures.makeInstalledApp(
              from: VersioneerPreviewFixtures.firefox))
        ]
      )
    ) {
      RootView()
    }
  }

  #Preview("Settings: Ignored Apps") {
    SettingsPreviewHost(
      appState: VersioneerPreviewFixtures.rootState(
        ignoredRules: [
          IgnoredAppRule.make(
            from: VersioneerPreviewFixtures.makeInstalledApp(
              from: VersioneerPreviewFixtures.firefox)),
          IgnoredAppRule.make(
            displayName: "Path Only",
            matchType: .path,
            rawValue: "/Applications/Path Only.app"
          )!,
        ]
      )
    )
  }
#endif
