import AppKit
import Foundation
import Logging
import Observation
import UniformTypeIdentifiers

nonisolated struct ReleaseNotesContent: Equatable, Sendable {
  let html: String?
  let url: URL?
}

/// Top-level shared application state.
@Observable
@MainActor
final class AppState {
  // MARK: - Services

  let settings: SettingsStore
  let scanner = AppScanner()
  let sparkleChecker = SparkleChecker()
  let electronChecker = ElectronChecker()
  let appStoreChecker = AppStoreChecker()
  let installCoordinator = InstallCoordinator()
  private let cacheStore: ScanCacheStore
  @ObservationIgnored private var directoryWatcher: DirectoryWatcher?

  var apiClient: InventoryAPIClient {
    InventoryAPIClient(baseURL: settings.baseURL)
  }

  var feedbackClient: FeedbackAPIClient {
    FeedbackAPIClient(baseURL: settings.baseURL)
  }

  // MARK: - Navigation

  enum FilterSection: String, CaseIterable, Identifiable {
    case all = "All Apps"
    case updatesAvailable = "Updates Available"
    case localOnly = "Local Only"
    case needsReview = "Needs Review"
    case ignored = "Ignored"

    var id: String { rawValue }

    var shortTitle: String {
      switch self {
      case .all: "All"
      case .updatesAvailable: "Updates"
      case .localOnly: "Local Only"
      case .needsReview: "Review"
      case .ignored: "Ignored"
      }
    }

    var systemImage: String {
      switch self {
      case .all: "app.dashed"
      case .updatesAvailable: "arrow.up.circle"
      case .localOnly: "desktopcomputer.trianglebadge.exclamationmark"
      case .needsReview: "scope"
      case .ignored: "minus.circle"
      }
    }

    var selectedSystemImage: String {
      switch self {
      case .all: "app.dashed"
      case .updatesAvailable: "arrow.up.circle.fill"
      case .localOnly: "desktopcomputer.trianglebadge.exclamationmark"
      case .needsReview: "scope"
      case .ignored: "minus.circle.fill"
      }
    }
  }

  var selectedSection: FilterSection = .all
  var selectedAppID: String?
  var resultsSort: ResultsBrowserSort = .updatesFirst

  // MARK: - Data

  var installedApps: [InstalledApp] = []
  var rawInventoryResults: [AppDecision] = []
  var inventoryResults: [AppDecision] = []
  var userIgnoredResultIDs: Set<String> = []
  var searchText: String = ""
  var lastScanCompletedAt: Date?

  /// Path lookup tables built after each scan, keyed by bundle ID or app name.
  private var appPathsByBundleId: [String: String] = [:]
  private var appPathsByName: [String: String] = [:]

  /// Installed app lookup tables for O(1) access.
  private var installedAppsByBundleId: [String: InstalledApp] = [:]
  private var installedAppsByName: [String: InstalledApp] = [:]

  /// Inventory results indexed by ID for O(1) lookups.
  private(set) var inventoryResultsByID: [String: AppDecision] = [:]

  /// Icon cache to avoid re-loading from disk on every view redraw.
  private var iconCache: [String: NSImage] = [:]

  /// Cached release notes keyed by release ID.
  private var releaseNotesCache: [String: ReleaseNotesContent?] = [:]

  // MARK: - Loading state

  enum LoadState: Equatable {
    case idle
    case scanning
    case submitting
    case done
    case error(String)
  }

  var loadState: LoadState = .idle

  // MARK: - Init

  init(
    settings: SettingsStore = SettingsStore(),
    cacheStore: ScanCacheStore = ScanCacheStore()
  ) {
    self.settings = settings
    self.cacheStore = cacheStore

    installCoordinator.onStateChange = { [weak self] in
      self?.rebuildResultsBrowserRows()
    }

    if let cached = cacheStore.load() {
      installedApps = cached.installedApps
      rawInventoryResults = cached.inventoryResults
      loadState = .done
      rebuildLookupTables()
      refreshDisplayedResults()
    }

    startDirectoryWatching()
  }

  /// Watches app directories for changes and triggers a rescan when apps are
  /// installed, updated, or removed outside of Versioneer.
  private func startDirectoryWatching() {
    let watcher = DirectoryWatcher(urls: settings.allScanRootURLs) { [weak self] in
      guard let self else { return }
      // Only auto-rescan if we're idle (not mid-scan or mid-install)
      guard self.loadState == .done || self.loadState == .idle else { return }
      Task { await self.scanAndSubmit() }
    }
    watcher.start()
    self.directoryWatcher = watcher
  }

  /// Whether we have cached inventory results to display while rescanning.
  var hasCachedResults: Bool {
    !inventoryResults.isEmpty
  }

  struct ScanSummary: Equatable, Sendable {
    let totalApps: Int
    let updatesAvailableCount: Int
    let localOnlyCount: Int
    let needsReviewCount: Int
    let ignoredCount: Int
    let lastCompletedAt: Date?
  }

  private(set) var scanSummary = ScanSummary(
    totalApps: 0,
    updatesAvailableCount: 0,
    localOnlyCount: 0,
    needsReviewCount: 0,
    ignoredCount: 0,
    lastCompletedAt: nil
  )

  private func rebuildScanSummary() {
    let visibleResults = inventoryResults.filter { !isUserIgnored($0) }

    scanSummary = ScanSummary(
      totalApps: visibleResults.count,
      updatesAvailableCount: visibleResults.filter { $0.decision == .updateAvailable }.count,
      localOnlyCount: inventoryResults.filter {
        $0.isLocalOnly && !isUserIgnored($0)
      }.count,
      needsReviewCount: inventoryResults.filter {
        $0.decision == .ambiguous && !isUserIgnored($0)
      }.count,
      ignoredCount: userIgnoredResultIDs.count,
      lastCompletedAt: lastScanCompletedAt
    )
  }

  private(set) var resultsBrowserRows: [ResultsBrowserRowPresentation] = []

  private func rebuildResultsBrowserRows() {
    let rows = filteredResults.map { result in
      ResultsBrowserRowPresentation.make(
        result: result,
        installState: installCoordinator.state(for: result)
      )
    }
    resultsBrowserRows = sort(rows: rows, by: resultsSort)
  }

  var updatableResults: [AppDecision] {
    inventoryResults.filter { $0.decision == .updateAvailable && !isUserIgnored($0) }
  }

  var visibleUpdateCount: Int {
    updatableResults.count
  }

  var selectedResult: AppDecision? {
    guard let selectedAppID else { return nil }
    return inventoryResultsByID[selectedAppID]
  }

  var statusBarPresentation: StatusBarPresentation {
    StatusBarPresentation.make(summary: scanSummary, loadState: loadState)
  }

  var filterPresentation: FilterPresentation {
    FilterPresentation.make(summary: scanSummary, selectedSection: selectedSection)
  }

  var ignoredAppRules: [IgnoredAppRule] {
    settings.ignoredAppRules
  }

  // MARK: - Computed filtered results

  var filteredResults: [AppDecision] {
    let sectionFiltered: [AppDecision]
    switch selectedSection {
    case .all:
      sectionFiltered = inventoryResults.filter { !isUserIgnored($0) }
    case .updatesAvailable:
      sectionFiltered = inventoryResults.filter {
        $0.decision == .updateAvailable && !isUserIgnored($0)
      }
    case .localOnly:
      sectionFiltered = inventoryResults.filter {
        $0.isLocalOnly && !isUserIgnored($0)
      }
    case .needsReview:
      sectionFiltered = inventoryResults.filter {
        $0.decision == .ambiguous && !isUserIgnored($0)
      }
    case .ignored:
      sectionFiltered = inventoryResults.filter { isUserIgnored($0) }
    }

    guard !searchText.isEmpty else { return sectionFiltered }
    return sectionFiltered.filter { result in
      result.appName.localizedCaseInsensitiveContains(searchText)
        || (result.bundleId?.localizedCaseInsensitiveContains(searchText) ?? false)
        || (result.matchedAppName?.localizedCaseInsensitiveContains(searchText) ?? false)
    }
  }

  // MARK: - Badge counts

  func badgeCount(for section: FilterSection) -> Int? {
    switch section {
    case .updatesAvailable:
      let count = inventoryResults.filter {
        $0.decision == .updateAvailable && !isUserIgnored($0)
      }.count
      return count > 0 ? count : nil
    case .localOnly:
      let count = inventoryResults.filter {
        $0.isLocalOnly && !isUserIgnored($0)
      }.count
      return count > 0 ? count : nil
    case .needsReview:
      let count = inventoryResults.filter {
        $0.decision == .ambiguous && !isUserIgnored($0)
      }.count
      return count > 0 ? count : nil
    case .ignored:
      let count = userIgnoredResultIDs.count
      return count > 0 ? count : nil
    default:
      return nil
    }
  }

  // MARK: - Actions

  func setSelectedSection(_ section: FilterSection) {
    selectedSection = section
    rebuildResultsBrowserRows()
    syncSelectedAppIDToVisibleRows()
  }

  func setResultsSort(_ sort: ResultsBrowserSort) {
    resultsSort = sort
    rebuildResultsBrowserRows()
    syncSelectedAppIDToVisibleRows()
  }

  func setSearchText(_ text: String) {
    searchText = text
    rebuildResultsBrowserRows()
    syncSelectedAppIDToVisibleRows()
  }

  /// Rebuilds path and installed-app lookup tables from the current `installedApps` array.
  private func rebuildLookupTables() {
    appPathsByBundleId = [:]
    appPathsByName = [:]
    installedAppsByBundleId = [:]
    installedAppsByName = [:]
    for app in installedApps {
      if let bundleId = app.bundleId {
        appPathsByBundleId[bundleId] = app.path
        installedAppsByBundleId[bundleId] = app
      }
      appPathsByName[app.name] = app.path
      installedAppsByName[app.name] = app
    }
  }

  /// Returns the locally extracted icon for an app decision, or a generic app icon.
  func appIcon(for result: AppDecision) -> NSImage {
    if let cached = iconCache[result.id] { return cached }

    let path: String? =
      if let bundleId = result.bundleId {
        appPathsByBundleId[bundleId]
      } else {
        appPathsByName[result.appName]
      }

    let icon: NSImage =
      if let path {
        NSWorkspace.shared.icon(forFile: path)
      } else {
        NSWorkspace.shared.icon(for: .applicationBundle)
      }

    iconCache[result.id] = icon
    return icon
  }

  func installedApp(for result: AppDecision) -> InstalledApp? {
    if let bundleId = result.bundleId {
      return installedAppsByBundleId[bundleId]
    }
    return installedAppsByName[result.appName]
  }

  func bundleIdText(for result: AppDecision) -> String? {
    installedApp(for: result)?.bundleId ?? result.bundleId
  }

  func appPathText(for result: AppDecision) -> String? {
    installedApp(for: result)?.path
  }

  func installedApp(matching rule: IgnoredAppRule) -> InstalledApp? {
    installedApps.first(where: rule.matches)
  }

  func ignoredAppRules(matching result: AppDecision) -> [IgnoredAppRule] {
    guard let installedApp = installedApp(for: result) else { return [] }
    return settings.ignoredAppRules.filter { $0.matches(installedApp) }
  }

  func isUserIgnored(_ result: AppDecision) -> Bool {
    userIgnoredResultIDs.contains(result.id)
  }

  func ignore(_ result: AppDecision) {
    guard let installedApp = installedApp(for: result) else { return }
    settings.addIgnoredAppRule(IgnoredAppRule.make(from: installedApp))
    refreshDisplayedResults()
  }

  func unignore(_ result: AppDecision) {
    let ruleIDs = Set(ignoredAppRules(matching: result).map(\.id))
    guard !ruleIDs.isEmpty else { return }
    settings.ignoredAppRules = settings.ignoredAppRules.filter { !ruleIDs.contains($0.id) }
    refreshDisplayedResults()
  }

  func addIgnoredAppRule(_ rule: IgnoredAppRule) {
    settings.addIgnoredAppRule(rule)
    refreshDisplayedResults()
  }

  func removeIgnoredAppRule(_ rule: IgnoredAppRule) {
    settings.removeIgnoredAppRule(rule)
    refreshDisplayedResults()
  }

  func openApp(_ result: AppDecision) {
    guard let installedApp = installedApp(for: result) else { return }

    let configuration = NSWorkspace.OpenConfiguration()
    NSWorkspace.shared.openApplication(
      at: URL(fileURLWithPath: installedApp.path),
      configuration: configuration
    ) { _, error in
      if let error {
        Logger.app.error("Failed to open app \(installedApp.name): \(error.localizedDescription)")
      }
    }
  }

  func revealAppInFinder(_ result: AppDecision) {
    guard let path = appPathText(for: result) else { return }
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
  }

  func copyBundleId(_ result: AppDecision) {
    guard let bundleId = bundleIdText(for: result) else { return }
    copyToPasteboard(bundleId)
  }

  func copyAppPath(_ result: AppDecision) {
    guard let path = appPathText(for: result) else { return }
    copyToPasteboard(path)
  }

  func scanAndSubmit() async {
    loadState = .scanning
    let previousSelectionID = selectedAppID
    if !hasCachedResults {
      selectedAppID = nil
    }

    let startTime = CFAbsoluteTimeGetCurrent()
    let apps = await scanner.scan(roots: settings.allScanRootURLs)
    let scanMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)

    installedApps = apps
    rebuildLookupTables()
    loadState = .submitting

    // Run backend + local checks in parallel
    let perApp = settings.perAppChannels
    let channelPrefs = perApp.isEmpty && settings.defaultChannel == "stable"
      ? nil
      : InventoryCheckRequest.ChannelPreferences(
          defaultChannel: settings.defaultChannel,
          perApp: perApp
        )
    async let backendTask = apiClient.checkInventory(
      apps: apps,
      scanDurationMs: scanMs,
      channelPreferences: channelPrefs
    )
    async let sparkleTask = sparkleChecker.checkAll(apps: apps)
    async let electronTask = electronChecker.checkAll(apps: apps)
    async let appStoreTask = appStoreChecker.checkAll(apps: apps)

    let sparkleResults = await sparkleTask
    let electronResults = await electronTask
    let appStoreResults = await appStoreTask

    // Enrich installed apps with confirmed App Store IDs from iTunes API
    for (index, app) in installedApps.enumerated() {
      if let storeResult = appStoreResults[app.id], app.masAppId == nil {
        installedApps[index] = app.withMasAppId(storeResult.masAppId)
      }
    }
    rebuildLookupTables()

    let localResults = buildLocalVersionMap(
      sparkle: sparkleResults, electron: electronResults, appStore: appStoreResults)

    do {
      let response = try await backendTask
      rawInventoryResults = mergeResults(
        backend: response.results,
        local: localResults,
        apps: apps
      )
      loadState = .done
      lastScanCompletedAt = Date()
      refreshDisplayedResults(preservingSelectionID: previousSelectionID)
      cacheStore.save(
        ScanCacheStore.CachedScanData(
          installedApps: installedApps,
          inventoryResults: rawInventoryResults
        ))
    } catch {
      // Backend failed — fall back to local results if we have any
      if !localResults.isEmpty {
        rawInventoryResults = buildLocalOnlyResults(local: localResults, apps: apps)
        loadState = .done
        lastScanCompletedAt = Date()
        refreshDisplayedResults(preservingSelectionID: previousSelectionID)
        cacheStore.save(
          ScanCacheStore.CachedScanData(
            installedApps: installedApps,
            inventoryResults: rawInventoryResults
          ))
      } else {
        loadState = .error(error.localizedDescription)
      }
    }
  }

  // MARK: - Result merging

  /// Unified local version info from any checker (Sparkle, Electron, etc.)
  private struct LocalVersionInfo {
    let latestVersion: String?
    let publishedAt: String?
  }

  /// Combines Sparkle, Electron, and MAS results into a single lookup by app ID.
  private func buildLocalVersionMap(
    sparkle: [String: SparkleChecker.SparkleResult],
    electron: [String: ElectronChecker.ElectronResult],
    appStore: [String: AppStoreChecker.AppStoreResult]
  ) -> [String: LocalVersionInfo] {
    var map: [String: LocalVersionInfo] = [:]
    for (id, result) in sparkle {
      map[id] = LocalVersionInfo(
        latestVersion: result.latestVersion, publishedAt: result.publishedAt)
    }
    for (id, result) in electron where map[id] == nil {
      map[id] = LocalVersionInfo(
        latestVersion: result.latestVersion, publishedAt: result.publishedAt)
    }
    for (id, result) in appStore where map[id] == nil {
      if let latestVersion = result.latestVersion {
        map[id] = LocalVersionInfo(latestVersion: latestVersion, publishedAt: result.releaseDate)
      }
    }
    return map
  }

  /// Merges backend decisions with local check results.
  /// Backend takes precedence for matched apps; local results fill in unknown/unmatched apps.
  /// MAS apps with unknown decisions are marked as ignored.
  private func mergeResults(
    backend: [AppDecision],
    local: [String: LocalVersionInfo],
    apps: [InstalledApp]
  ) -> [AppDecision] {
    var results = backend

    for (index, decision) in results.enumerated() {
      let matchingApp = findInstalledApp(for: decision, in: apps)

      // For unmatched apps, try local version data
      guard decision.isLocalOnly else { continue }
      guard let matchingApp, let localInfo = local[matchingApp.id] else { continue }

      results[index] = AppDecision(
        appName: decision.appName,
        bundleId: decision.bundleId,
        installedVersion: decision.installedVersion,
        matchedAppId: decision.matchedAppId,
        matchedAppName: decision.matchedAppName,
        matchConfidence: decision.matchConfidence,
        decision: decisionFromVersion(
          latest: localInfo.latestVersion,
          installed: decision.installedVersion
        ),
        trackingState: decision.trackingState,
        localReasonCode: decision.localReasonCode,
        latestVersion: localInfo.latestVersion ?? decision.latestVersion,
        latestVersionRaw: localInfo.latestVersion ?? decision.latestVersionRaw,
        latestReleaseId: decision.latestReleaseId,
        channel: decision.channel,
        availableChannels: decision.availableChannels,
        homebrewCaskToken: decision.homebrewCaskToken,
        releasedAt: localInfo.publishedAt ?? decision.releasedAt,
        staleSince: decision.staleSince,
        iconUrl: decision.iconUrl,
        artifact: decision.artifact,
        installStrategy: decision.installStrategy
      )
    }

    return results
  }

  /// Builds AppDecision entries from local results when the backend is unavailable.
  private func buildLocalOnlyResults(
    local: [String: LocalVersionInfo],
    apps: [InstalledApp]
  ) -> [AppDecision] {
    apps.map { app in
      let decision: AppDecision.Decision
      let latestVersion: String?
      let releasedAt: String?

      if let info = local[app.id] {
        decision = decisionFromVersion(latest: info.latestVersion, installed: app.version)
        latestVersion = info.latestVersion
        releasedAt = info.publishedAt
      } else {
        decision = .localOnly
        latestVersion = nil
        releasedAt = nil
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
        homebrewCaskToken: nil,
        releasedAt: releasedAt,
        staleSince: nil,
        iconUrl: nil,
        artifact: nil,
        installStrategy: nil
      )
    }
  }

  /// Finds the InstalledApp that corresponds to a backend AppDecision.
  private func findInstalledApp(for decision: AppDecision, in apps: [InstalledApp]) -> InstalledApp?
  {
    if let bundleId = decision.bundleId {
      return apps.first { $0.bundleId == bundleId }
    }
    return apps.first { $0.name == decision.appName }
  }

  /// Determines update decision by comparing version strings.
  private func decisionFromVersion(latest: String?, installed: String?) -> AppDecision.Decision {
    guard let latest, let installed else { return .localOnly }
    if latest == installed { return .upToDate }
    if compareVersionStrings(latest, isNewerThan: installed) {
      return .updateAvailable
    }
    return .upToDate
  }

  /// Returns true if `a` is a newer version than `b`.
  private func compareVersionStrings(_ a: String, isNewerThan b: String) -> Bool {
    Version(a) > Version(b)
  }

  // MARK: - Release Notes

  /// Fetches release notes for a given release ID. Returns cached result if available.
  func fetchReleaseNotes(releaseId: String) async -> ReleaseNotesContent? {
    if let cached = releaseNotesCache[releaseId] {
      return cached
    }
    do {
      let response = try await apiClient.fetchReleaseNotes(releaseId: releaseId)
      let content = ReleaseNotesContent(
        html: response.releaseNotesHtml,
        url: response.releaseNotesUrl.flatMap(URL.init(string:))
      )
      releaseNotesCache[releaseId] = content
      return content
    } catch {
      Logger.api.error(
        "Failed to fetch release notes for \(releaseId): \(error.localizedDescription)")
      releaseNotesCache[releaseId] = nil
      return nil
    }
  }

  func submitWrongMatch(for result: AppDecision, comment: String?) async throws {
    guard let matchedAppId = result.matchedAppId else { return }
    let feedback = FeedbackRequest.WrongMatch(
      appName: result.appName,
      bundleId: result.bundleId,
      matchedAppId: matchedAppId,
      comment: comment
    )
    try await feedbackClient.submitWrongMatch(feedback)
  }

  func submitWrongVersion(for result: AppDecision, reportedVersion: String?, comment: String?)
    async throws
  {
    guard let matchedAppId = result.matchedAppId else { return }
    let feedback = FeedbackRequest.WrongVersion(
      appName: result.appName,
      bundleId: result.bundleId,
      matchedAppId: matchedAppId,
      reportedLatestVersion: reportedVersion,
      comment: comment
    )
    try await feedbackClient.submitWrongVersion(feedback)
  }

  func submitMissingApp(for result: AppDecision, homepageUrl: String?, comment: String?)
    async throws
  {
    let feedback = FeedbackRequest.MissingApp(
      appName: result.appName,
      bundleId: result.bundleId,
      homepageUrl: homepageUrl,
      comment: comment
    )
    try await feedbackClient.submitMissingApp(feedback)
  }

  func openDetail(id: String) {
    selectedAppID = inventoryResultsByID[id] == nil ? nil : id
  }

  func closeDetail() {
    selectedAppID = nil
  }

  func installAll() async {
    for target in updatableResults {
      await install(target)
    }
  }

  func install(_ result: AppDecision) async {
    guard let installedApp = installedApp(for: result) else { return }

    let didInstall = await installCoordinator.startInstall(
      result: result,
      installedApp: installedApp,
      apiClient: apiClient
    )

    if didInstall {
      await scanAndSubmit()
    }
  }

  /// Triggers a Homebrew Cask upgrade for the given app decision.
  /// Uses the cask token from the local InstalledApp (primary) or the server response (fallback).
  func brewUpgrade(_ result: AppDecision) async {
    guard let installedApp = installedApp(for: result) else { return }
    let caskToken = installedApp.homebrewCaskToken ?? result.homebrewCaskToken
    guard let caskToken, !caskToken.isEmpty else { return }

    let didUpgrade = await installCoordinator.startBrewUpgrade(
      result: result,
      caskToken: caskToken
    )

    if didUpgrade {
      await scanAndSubmit()
    }
  }

  /// Returns true if the given result represents a Homebrew-installed app.
  func isHomebrewInstalled(for result: AppDecision) -> Bool {
    installedApp(for: result)?.isHomebrewInstalled ?? false
  }

  /// Returns the Homebrew cask token for the given result, from local detection or server.
  func homebrewCaskToken(for result: AppDecision) -> String? {
    installedApp(for: result)?.homebrewCaskToken ?? result.homebrewCaskToken
  }

  /// Triggers a mas-cli upgrade for the given app decision.
  func masUpgrade(_ result: AppDecision) async {
    guard let installedApp = installedApp(for: result) else { return }
    guard let masAppId = installedApp.masAppId, !masAppId.isEmpty else { return }
    guard let masCliPath = settings.resolvedMasCliPath else { return }

    let didUpgrade = await installCoordinator.startMasUpgrade(
      result: result,
      masAppId: masAppId,
      masCliPath: masCliPath,
      installedApp: installedApp
    )

    if didUpgrade {
      await scanAndSubmit()
    }
  }

  /// Returns true if the given result can be upgraded via mas-cli.
  func isMasUpgradeable(for result: AppDecision) -> Bool {
    guard let app = installedApp(for: result) else { return false }
    return app.isMasApp && app.masAppId != nil && settings.isMasCliAvailable
  }

  func refreshDisplayedResults(preservingSelectionID selectionID: String? = nil) {
    let preferredSelectionID = selectionID ?? selectedAppID
    rebuildLookupTables()
    userIgnoredResultIDs = Set(
      rawInventoryResults.compactMap { decision in
        guard let installedApp = self.installedApp(for: decision),
          settings.isIgnored(installedApp)
        else { return nil }
        return decision.id
      })

    inventoryResults = rawInventoryResults
    inventoryResultsByID = Dictionary(uniqueKeysWithValues: inventoryResults.map { ($0.id, $0) })
    rebuildScanSummary()
    rebuildResultsBrowserRows()
    syncSelectedAppIDToVisibleRows(preferredSelectionID: preferredSelectionID)
  }

  private func sort(
    rows: [ResultsBrowserRowPresentation],
    by sort: ResultsBrowserSort
  ) -> [ResultsBrowserRowPresentation] {
    rows.sorted { lhs, rhs in
      switch sort {
      case .updatesFirst:
        if lhs.defaultSortRank != rhs.defaultSortRank {
          return lhs.defaultSortRank < rhs.defaultSortRank
        }
        return lhs.appName.localizedStandardCompare(rhs.appName) == .orderedAscending
      case .name:
        return lhs.appName.localizedStandardCompare(rhs.appName) == .orderedAscending
      case .latestVersion:
        if lhs.latestVersionSortKey != rhs.latestVersionSortKey {
          return lhs.latestVersionSortKey.localizedStandardCompare(rhs.latestVersionSortKey)
            == .orderedDescending
        }
        return lhs.appName.localizedStandardCompare(rhs.appName) == .orderedAscending
      case .releasedDate:
        switch (lhs.releasedAtSortDate, rhs.releasedAtSortDate) {
        case (let lhsDate?, let rhsDate?):
          if lhsDate != rhsDate {
            return lhsDate > rhsDate
          }
        case (.some, .none):
          return true
        case (.none, .some):
          return false
        case (.none, .none):
          break
        }
        return lhs.appName.localizedStandardCompare(rhs.appName) == .orderedAscending
      }
    }
  }

  private func syncSelectedAppIDToVisibleRows(preferredSelectionID: String? = nil) {
    let candidateID = preferredSelectionID ?? selectedAppID
    guard let candidateID else {
      selectedAppID = nil
      return
    }

    let isVisible = resultsBrowserRows.contains { $0.id == candidateID }
    selectedAppID = isVisible ? candidateID : nil
  }

  private func copyToPasteboard(_ value: String) {
    let pasteboard = NSPasteboard.general
    pasteboard.clearContents()
    pasteboard.setString(value, forType: .string)
  }
}
