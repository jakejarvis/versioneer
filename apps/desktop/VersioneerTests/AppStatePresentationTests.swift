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
      install: .unavailable,
      artifact: nil
    )
    let update = DesktopUITestFixtures.makeDecision(
      appName: "Update",
      bundleId: "com.example.update",
      decision: .updateAvailable
    )
    let unknown = DesktopUITestFixtures.makeDecision(
      appName: "Mystery",
      bundleId: "com.example.mystery",
      decision: .unknown,
      install: .unavailable,
      artifact: nil
    )

    seed(state, with: [unknown, stable, update])
    state.installCoordinator.previewSetState(
      DesktopUITestFixtures.operationState(
        appDisplayName: "Stable",
        phase: .downloading,
        detail: "Downloading update…"
      ),
      for: stable
    )

    let orderedIDs = state.resultsBrowserRows.map(\.id)

    #expect(orderedIDs == [stable.id, update.id, unknown.id])
  }

  @Test func sectionBadgesAndSearchReflectVisibleResults() {
    let state = AppState()
    let update = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )
    let unknown = DesktopUITestFixtures.makeDecision(
      appName: "Mystery App",
      bundleId: "com.example.mystery",
      decision: .unknown,
      install: .unavailable,
      artifact: nil
    )
    let ambiguous = DesktopUITestFixtures.makeDecision(
      appName: "Unknown Utility",
      bundleId: "com.example.utility",
      decision: .ambiguous,
      install: .unavailable,
      artifact: nil
    )
    let supported = DesktopUITestFixtures.makeDecision(
      appName: "Arc",
      bundleId: "company.thebrowser.Browser",
      decision: .upToDate,
      install: .unavailable,
      artifact: nil
    )

    seed(state, with: [update, unknown, ambiguous, supported])
    state.selectedSection = .unknown

    #expect(state.badgeCount(for: .updatesAvailable) == 1)
    #expect(state.badgeCount(for: .unknown) == 2)
    #expect(state.filteredResults.map(\.id) == [unknown.id, ambiguous.id])

    state.searchText = "Utility"

    #expect(state.filteredResults.map(\.id) == [ambiguous.id])
    #expect(state.scanSummary.updatesAvailableCount == 1)
    #expect(state.scanSummary.unknownCount == 2)
  }

  @Test func userIgnoredAppsMoveIntoIgnoredSectionAndRestoreAfterUnignore() {
    let state = AppState()
    let update = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )
    let systemIgnored = DesktopUITestFixtures.makeDecision(
      appName: "App Store Utility",
      bundleId: "com.example.mas",
      decision: .ignored,
      install: .unavailable,
      artifact: nil
    )

    seed(state, with: [update, systemIgnored])

    state.ignore(update)

    #expect(state.scanSummary.totalApps == 1)
    #expect(state.scanSummary.ignoredCount == 1)
    #expect(state.updatableResults.isEmpty)

    state.selectedSection = .all
    #expect(state.filteredResults.map(\.id) == [systemIgnored.id])

    state.selectedSection = .unsupported
    #expect(state.filteredResults.map(\.id) == [systemIgnored.id])

    state.selectedSection = .ignored
    #expect(state.filteredResults.map(\.id) == [update.id])
    #expect(state.inventoryResults.first { $0.id == update.id }?.decision == .ignored)
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
        inventoryResults: [update],
        snapshotId: "snapshot"
      ))

    let reloadedState = AppState(settings: settings, cacheStore: cacheStore)

    #expect(reloadedState.rawInventoryResults.first?.decision == .updateAvailable)
    #expect(reloadedState.inventoryResults.first?.decision == .ignored)
    #expect(reloadedState.scanSummary.ignoredCount == 1)
    #expect(reloadedState.filteredResults.isEmpty)
  }

  private func seed(_ state: AppState, with results: [AppDecision]) {
    state.installedApps = results.map(DesktopUITestFixtures.makeInstalledApp)
    state.rawInventoryResults = results
    state.inventoryResults = results
    state.refreshDisplayedResults()
  }
}
