import Foundation
import Testing

@testable import Versioneer

@MainActor
struct AppStatePresentationTests {
  @Test func updatesFirstSortPrioritizesActiveInstallsThenUpdates() {
    let state = AppState()
    let stable = DesktopUITestFixtures.makeDecision(
      appName: "Stable",
      bundleId: "com.example.stable",
      decision: .upToDate,
      installStrategy: nil,
      artifact: nil
    )
    let update = DesktopUITestFixtures.makeDecision(
      appName: "Update",
      bundleId: "com.example.update",
      decision: .updateAvailable
    )
    let localOnly = DesktopUITestFixtures.makeDecision(
      appName: "Mystery",
      bundleId: "com.example.mystery",
      decision: .localOnly,
      trackingState: .localOnly,
      localReasonCode: .notFound,
      installStrategy: nil,
      artifact: nil
    )

    seed(state, with: [localOnly, stable, update])
    state.installCoordinator.previewSetState(
      DesktopUITestFixtures.operationState(
        appDisplayName: "Stable",
        phase: .downloading,
        detail: "Downloading update…"
      ),
      for: stable
    )

    let orderedIDs = state.resultsBrowserRows.map(\.id)

    #expect(orderedIDs == [stable.id, update.id, localOnly.id])
  }

  @Test func sectionBadgesAndSearchReflectVisibleResults() {
    let state = AppState()
    let update = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )
    let localOnly = DesktopUITestFixtures.makeDecision(
      appName: "Mystery App",
      bundleId: "com.example.mystery",
      decision: .localOnly,
      trackingState: .localOnly,
      localReasonCode: .notFound,
      installStrategy: nil,
      artifact: nil
    )
    let ambiguous = DesktopUITestFixtures.makeDecision(
      appName: "Unknown Utility",
      bundleId: "com.example.utility",
      decision: .ambiguous,
      trackingState: .localOnly,
      localReasonCode: .ambiguousMatch,
      installStrategy: nil,
      artifact: nil
    )
    let supported = DesktopUITestFixtures.makeDecision(
      appName: "Arc",
      bundleId: "company.thebrowser.Browser",
      decision: .upToDate,
      installStrategy: nil,
      artifact: nil
    )

    seed(state, with: [update, localOnly, ambiguous, supported])
    state.selectedSection = .localOnly

    #expect(state.badgeCount(for: .updatesAvailable) == 1)
    #expect(state.badgeCount(for: .localOnly) == 2)
    #expect(state.badgeCount(for: .needsReview) == 1)
    #expect(state.filteredResults.map(\.id) == [localOnly.id, ambiguous.id])

    state.searchText = "Utility"

    #expect(state.filteredResults.map(\.id) == [ambiguous.id])
    #expect(state.scanSummary.updatesAvailableCount == 1)
    #expect(state.scanSummary.localOnlyCount == 2)
    #expect(state.scanSummary.needsReviewCount == 1)
  }

  @Test func userIgnoredAppsMoveIntoIgnoredSectionAndRestoreAfterUnignore() {
    let state = AppState()
    let update = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )

    seed(state, with: [update])

    state.ignore(update)

    #expect(state.scanSummary.totalApps == 0)
    #expect(state.scanSummary.ignoredCount == 1)
    #expect(state.updatableResults.isEmpty)

    state.selectedSection = .all
    #expect(state.filteredResults.isEmpty)

    state.selectedSection = .ignored
    #expect(state.filteredResults.map(\.id) == [update.id])
    #expect(state.inventoryResults.first { $0.id == update.id }?.decision == .updateAvailable)
    #expect(state.rawInventoryResults.first { $0.id == update.id }?.decision == .updateAvailable)

    state.unignore(update)

    #expect(state.scanSummary.ignoredCount == 0)
    #expect(state.updatableResults.map(\.id) == [update.id])
    #expect(state.inventoryResults.first { $0.id == update.id }?.decision == .updateAvailable)
  }

  @Test func cachedRawResultsReapplyIgnoreRulesOnLaunch() throws {
    let suiteName = "com.jakejarvis.versioneer.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defer {
      defaults.removePersistentDomain(forName: suiteName)
    }

    let cacheDirectory = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(
      at: cacheDirectory,
      withIntermediateDirectories: true
    )
    defer {
      try? FileManager.default.removeItem(at: cacheDirectory)
    }

    let cacheURL = cacheDirectory.appendingPathComponent("ScanCache.json")
    let cacheStore = ScanCacheStore(fileURLOverride: cacheURL)
    let settings = SettingsStore(defaults: defaults)

    let update = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )
    let installedApps = [DesktopUITestFixtures.makeInstalledApp(from: update)]

    settings.addIgnoredAppRule(IgnoredAppRule.make(from: installedApps[0]))
    cacheStore.save(
      ScanCacheStore.CachedScanData(
        installedApps: installedApps,
        inventoryResults: [update]
      ))

    let reloadedState = AppState(settings: settings, cacheStore: cacheStore)

    #expect(reloadedState.rawInventoryResults.first?.decision == .updateAvailable)
    #expect(reloadedState.scanSummary.ignoredCount == 1)
    #expect(reloadedState.filteredResults.isEmpty)
  }

  @Test func bundlelessDuplicateNamesRetainDistinctInstalledAppTargets() {
    let state = AppState()

    let firstDecision = AppDecision(
      appName: "Helper",
      bundleId: nil,
      installedVersion: "1.0",
      matchedAppId: nil,
      matchedAppName: nil,
      matchConfidence: nil,
      decision: .localOnly,
      trackingState: .localOnly,
      localReasonCode: .notFound,
      latestVersion: nil,
      latestVersionRaw: nil,
      latestReleaseId: nil,
      channel: nil,
      availableChannels: nil,
      homebrewCaskToken: nil,
      releasedAt: nil,
      staleSince: nil,
      iconUrl: nil,
      artifact: nil,
      installStrategy: nil
    )
    let secondDecision = AppDecision(
      appName: "Helper",
      bundleId: nil,
      installedVersion: "1.0",
      matchedAppId: nil,
      matchedAppName: nil,
      matchConfidence: nil,
      decision: .localOnly,
      trackingState: .localOnly,
      localReasonCode: .notFound,
      latestVersion: nil,
      latestVersionRaw: nil,
      latestReleaseId: nil,
      channel: nil,
      availableChannels: nil,
      homebrewCaskToken: nil,
      releasedAt: nil,
      staleSince: nil,
      iconUrl: nil,
      artifact: nil,
      installStrategy: nil
    )

    let firstInstalledApp = InstalledApp(
      name: "Helper",
      bundleId: nil,
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Applications/Helper.app",
      architecture: nil,
      sparkleFeedUrl: nil,
      sparklePublicKey: nil,
      isSparkleApp: false,
      isMasApp: false,
      masAppId: nil,
      isElectronApp: false,
      electronUpdateProvider: nil,
      electronUpdateUrl: nil,
      codeSigningAuthority: nil,
      appCategory: nil,
      minMacOSVersion: nil,
      isHomebrewInstalled: false,
      homebrewCaskToken: nil
    )
    let secondInstalledApp = InstalledApp(
      name: "Helper",
      bundleId: nil,
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Users/test/Applications/Helper.app",
      architecture: nil,
      sparkleFeedUrl: nil,
      sparklePublicKey: nil,
      isSparkleApp: false,
      isMasApp: false,
      masAppId: nil,
      isElectronApp: false,
      electronUpdateProvider: nil,
      electronUpdateUrl: nil,
      codeSigningAuthority: nil,
      appCategory: nil,
      minMacOSVersion: nil,
      isHomebrewInstalled: false,
      homebrewCaskToken: nil
    )

    state.installedApps = [firstInstalledApp, secondInstalledApp]
    state.rawInventoryResults = [firstDecision, secondDecision]
    state.refreshDisplayedResults()

    #expect(state.inventoryResults.count == 2)
    #expect(Set(state.inventoryResults.map(\.id)).count == 2)
    #expect(
      Set(state.inventoryResults.compactMap { state.appPathText(for: $0) })
        == Set([firstInstalledApp.path, secondInstalledApp.path])
    )
  }

  @Test func localHomebrewUpdatesExposePrimaryActionWithoutGenericInstallRoute() throws {
    let state = AppState()

    let decision = AppDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      installedVersion: "126.0",
      matchedAppId: nil,
      matchedAppName: nil,
      matchConfidence: nil,
      decision: .updateAvailable,
      trackingState: .localOnly,
      localReasonCode: .notFound,
      latestVersion: "127.0",
      latestVersionRaw: "127.0",
      latestReleaseId: nil,
      channel: nil,
      availableChannels: nil,
      homebrewCaskToken: "firefox",
      releasedAt: nil,
      staleSince: nil,
      iconUrl: nil,
      artifact: nil,
      installStrategy: nil,
      localAppID: "/Applications/Firefox.app"
    )
    let installedApp = InstalledApp(
      name: "Firefox",
      bundleId: "org.mozilla.firefox",
      version: "126.0",
      buildNumber: nil,
      teamId: "43AQ936H96",
      path: "/Applications/Firefox.app",
      architecture: nil,
      sparkleFeedUrl: nil,
      sparklePublicKey: nil,
      isSparkleApp: false,
      isMasApp: false,
      masAppId: nil,
      isElectronApp: false,
      electronUpdateProvider: nil,
      electronUpdateUrl: nil,
      codeSigningAuthority: nil,
      appCategory: nil,
      minMacOSVersion: nil,
      isHomebrewInstalled: true,
      homebrewCaskToken: "firefox"
    )

    state.installedApps = [installedApp]
    state.rawInventoryResults = [decision]
    state.refreshDisplayedResults()

    let row = try #require(state.resultsBrowserRows.first)
    #expect(row.canInstall == false)
    #expect(row.hasUpdateAction == true)
    #expect(state.canPerformPrimaryUpdate(for: decision))
  }

  @Test func localMasUpdatesExposePrimaryActionWithoutGenericInstallRoute() throws {
    let state = AppState()

    let decision = AppDecision(
      appName: "Pages",
      bundleId: "com.apple.iWork.Pages",
      installedVersion: "13.0",
      matchedAppId: nil,
      matchedAppName: nil,
      matchConfidence: nil,
      decision: .updateAvailable,
      trackingState: .localOnly,
      localReasonCode: .notFound,
      latestVersion: "14.0",
      latestVersionRaw: "14.0",
      latestReleaseId: nil,
      channel: nil,
      availableChannels: nil,
      homebrewCaskToken: nil,
      releasedAt: nil,
      staleSince: nil,
      iconUrl: nil,
      artifact: nil,
      installStrategy: nil,
      localAppID: "/Applications/Pages.app"
    )
    let installedApp = InstalledApp(
      name: "Pages",
      bundleId: "com.apple.iWork.Pages",
      version: "13.0",
      buildNumber: nil,
      teamId: "APPLETEAMID",
      path: "/Applications/Pages.app",
      architecture: nil,
      sparkleFeedUrl: nil,
      sparklePublicKey: nil,
      isSparkleApp: false,
      isMasApp: true,
      masAppId: "409201541",
      isElectronApp: false,
      electronUpdateProvider: nil,
      electronUpdateUrl: nil,
      codeSigningAuthority: nil,
      appCategory: nil,
      minMacOSVersion: nil,
      isHomebrewInstalled: false,
      homebrewCaskToken: nil
    )

    state.installedApps = [installedApp]
    state.rawInventoryResults = [decision]
    state.refreshDisplayedResults()

    let row = try #require(state.resultsBrowserRows.first)
    #expect(row.canInstall == false)
    #expect(row.hasUpdateAction == true)
    #expect(state.canPerformPrimaryUpdate(for: decision))
  }

  private func seed(_ state: AppState, with results: [AppDecision]) {
    state.installedApps = results.map(DesktopUITestFixtures.makeInstalledApp)
    state.rawInventoryResults = results
    state.inventoryResults = results
    state.refreshDisplayedResults()
  }
}
