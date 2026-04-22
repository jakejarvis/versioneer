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
  let homebrewChecker = HomebrewChecker()
  let installCoordinator = InstallCoordinator()
  private var _attestClient: AppAttestClient?
  private var _attestClientBaseURL: URL?

  enum InstallConfirmationRequest: Equatable {
    case none
    case installAll
    case installResult(String)
  }

  var attestClient: AppAttestClient {
    let url = settings.baseURL
    if let existing = _attestClient, _attestClientBaseURL == url {
      return existing
    }
    let client = AppAttestClient(baseURL: url)
    _attestClient = client
    _attestClientBaseURL = url
    return client
  }
  private let cacheStore: ScanCacheStore
  @ObservationIgnored private var directoryWatcher: DirectoryWatcher?

  var apiClient: InventoryAPIClient {
    InventoryAPIClient(baseURL: settings.baseURL, tokenProvider: attestClient)
  }

  var feedbackClient: FeedbackAPIClient {
    FeedbackAPIClient(baseURL: settings.baseURL, tokenProvider: attestClient)
  }

  var preflightClient: PreflightAPIClient {
    PreflightAPIClient(baseURL: settings.baseURL)
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
  private(set) var pendingInstallConfirmation: InstallConfirmationRequest = .none
  @ObservationIgnored weak var windowUndoManager: UndoManager?

  // MARK: - Data

  var installedApps: [InstalledApp] = []
  var rawInventoryResults: [AppDecision] = []
  var inventoryResults: [AppDecision] = []
  var userIgnoredResultIDs: Set<String> = []
  var searchText: String = ""
  var lastScanCompletedAt: Date?

  /// Installed app lookup tables for O(1) access.
  private var installedAppsByID: [String: InstalledApp] = [:]
  private var installedAppsByBundleId: [String: InstalledApp] = [:]
  private var installedAppsByName: [String: [InstalledApp]] = [:]

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
    resultsSort = settings.resultsSortMode

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

    configureDirectoryWatcher()
    FirebaseBootstrapper.configureIfNeeded(
      analyticsEnabled: settings.analyticsEnabled,
      crashlyticsEnabled: settings.crashlyticsEnabled
    )
  }

  /// Watches app directories for changes and triggers a rescan when apps are
  /// installed, updated, or removed outside of Versioneer.
  private func configureDirectoryWatcher() {
    stopDirectoryWatching()

    guard settings.directoryWatcherEnabled else {
      return
    }

    let watcher = DirectoryWatcher(urls: settings.allScanRootURLs) { [weak self] in
      guard let self else { return }
      // Only auto-rescan if we're idle (not mid-scan or mid-install)
      guard self.loadState == .done || self.loadState == .idle else { return }
      Task { await self.scanAndSubmit() }
    }
    watcher.start()
    self.directoryWatcher = watcher
  }

  private func stopDirectoryWatching() {
    directoryWatcher?.stop()
    directoryWatcher = nil
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
      let installState = installCoordinator.state(for: result)
      return ResultsBrowserRowPresentation.make(
        result: result,
        installState: installState,
        hasUpdateAction: canPerformPrimaryUpdate(for: result, installState: installState)
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
    settings.resultsSortMode = sort
    rebuildResultsBrowserRows()
    syncSelectedAppIDToVisibleRows()
  }

  func requestInstallAll() {
    guard !updatableResults.isEmpty else { return }

    if settings.confirmInstallAll {
      pendingInstallConfirmation = .installAll
    } else {
      Task { await installAll() }
    }
  }

  func requestPrimaryUpdate(for result: AppDecision) {
    guard canPerformPrimaryUpdate(for: result) else { return }

    if settings.confirmPrivilegedInstall, result.installStrategy?.requiresAdmin ?? false {
      pendingInstallConfirmation = .installResult(result.id)
    } else {
      Task { await performPrimaryUpdate(for: result) }
    }
  }

  func confirmPendingInstallRequest() {
    let request = pendingInstallConfirmation
    pendingInstallConfirmation = .none

    switch request {
    case .none:
      return
    case .installAll:
      Task { await installAll() }
    case .installResult(let resultID):
      guard let result = inventoryResultsByID[resultID] else { return }
      Task { await performPrimaryUpdate(for: result) }
    }
  }

  func cancelPendingInstallRequest() {
    pendingInstallConfirmation = .none
  }

  func pendingInstallConfirmationTitle() -> String {
    switch pendingInstallConfirmation {
    case .none:
      return ""
    case .installAll:
      return "Install all updates"
    case .installResult(let resultID):
      guard let result = inventoryResultsByID[resultID] else {
        return "Install update"
      }
      return "Install \(result.appName)"
    }
  }

  func pendingInstallConfirmationMessage() -> String {
    switch pendingInstallConfirmation {
    case .none:
      return ""
    case .installAll:
      return "Versioneer found \(updatableResults.count) updates. Continue with a bulk install?"
    case .installResult(let resultID):
      guard let result = inventoryResultsByID[resultID] else {
        return "Versioneer needs to continue with an admin-required install."
      }
      return "\(result.appName) requires administrator privileges. Continue with this install?"
    }
  }

  func setDirectoryWatcherEnabled(_ enabled: Bool) {
    settings.directoryWatcherEnabled = enabled
    configureDirectoryWatcher()
  }

  func addExtraScanRoot(_ path: String) {
    settings.addExtraScanRoot(path)
    configureDirectoryWatcher()
  }

  func removeExtraScanRoot(_ path: String) {
    settings.removeExtraScanRoot(path)
    configureDirectoryWatcher()
  }

  func setAnalyticsEnabled(_ enabled: Bool) {
    settings.analyticsEnabled = enabled
    FirebaseBootstrapper.configureIfNeeded(
      analyticsEnabled: settings.analyticsEnabled,
      crashlyticsEnabled: settings.crashlyticsEnabled
    )
  }

  func setCrashlyticsEnabled(_ enabled: Bool) {
    settings.crashlyticsEnabled = enabled
    FirebaseBootstrapper.configureIfNeeded(
      analyticsEnabled: settings.analyticsEnabled,
      crashlyticsEnabled: settings.crashlyticsEnabled
    )
  }

  func setSearchText(_ text: String) {
    searchText = text
    rebuildResultsBrowserRows()
    syncSelectedAppIDToVisibleRows()
  }

  /// Rebuilds installed-app lookup tables from the current `installedApps` array.
  private func rebuildLookupTables() {
    installedAppsByID = [:]
    installedAppsByBundleId = [:]
    installedAppsByName = [:]
    for app in installedApps.sorted(by: { lhs, rhs in
      lhs.path.localizedStandardCompare(rhs.path) == .orderedAscending
    }) {
      installedAppsByID[app.id] = app
      if let bundleId = app.bundleId {
        installedAppsByBundleId[bundleId] = app
      }
      installedAppsByName[app.name, default: []].append(app)
    }
  }

  /// Returns the locally extracted icon for an app decision, or a generic app icon.
  func appIcon(for result: AppDecision) -> NSImage {
    if let cached = iconCache[result.id] { return cached }

    let icon: NSImage =
      if let installedApp = installedApp(for: result) {
        NSWorkspace.shared.icon(forFile: installedApp.path)
      } else {
        NSWorkspace.shared.icon(for: .applicationBundle)
      }

    iconCache[result.id] = icon
    return icon
  }

  func installedApp(for result: AppDecision) -> InstalledApp? {
    if let localAppID = result.localAppID,
      let installedApp = installedAppsByID[localAppID]
    {
      return installedApp
    }

    if let bundleId = result.bundleId {
      return installedAppsByBundleId[bundleId]
    }

    let candidates = installedAppsByName[result.appName] ?? []
    guard candidates.count == 1 else { return nil }
    return candidates[0]
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

  func ignore(_ result: AppDecision, undoManager: UndoManager? = nil) {
    guard let installedApp = installedApp(for: result) else { return }
    let rule = IgnoredAppRule.make(from: installedApp)

    withUndo("Ignore \(result.appName)", undoManager: undoManager) { state in
      state.settings.addIgnoredAppRule(rule)
      state.refreshDisplayedResults()
    } reverse: { state in
      state.settings.removeIgnoredAppRule(rule)
      state.refreshDisplayedResults()
    }
  }

  func unignore(_ result: AppDecision, undoManager: UndoManager? = nil) {
    let rules = ignoredAppRules(matching: result)
    let ruleIDs = Set(rules.map(\.id))
    guard !ruleIDs.isEmpty else { return }

    withUndo("Unignore \(result.appName)", undoManager: undoManager) { state in
      state.settings.ignoredAppRules = state.settings.ignoredAppRules.filter {
        !ruleIDs.contains($0.id)
      }
      state.refreshDisplayedResults()
    } reverse: { state in
      for rule in rules {
        state.settings.addIgnoredAppRule(rule)
      }
      state.refreshDisplayedResults()
    }
  }

  private func withUndo(
    _ actionName: String,
    undoManager: UndoManager?,
    forward: @escaping (AppState) -> Void,
    reverse: @escaping (AppState) -> Void
  ) {
    forward(self)
    undoManager?.registerUndo(withTarget: self) { state in
      reverse(state)
      undoManager?.registerUndo(withTarget: state) { state in
        forward(state)
      }
      undoManager?.setActionName(actionName)
    }
    undoManager?.setActionName(actionName)
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

  /// Fetches client preflight config from the server (dismissed bundle IDs, etc.).
  /// Fails silently — uses previously cached values if the request fails.
  func loadPreflight() async {
    do {
      let preflight = try await preflightClient.fetchPreflight()
      let freshSet = Set(preflight.dismissedBundleIds)
      if freshSet != settings.serverDismissedBundleIds {
        settings.serverDismissedBundleIds = freshSet
      }
    } catch {
      Logger.api.warning("Failed to fetch preflight config: \(error.localizedDescription)")
    }
  }

  func scanAndSubmit() async {
    loadState = .scanning
    let previousSelectionID = selectedAppID
    if !hasCachedResults {
      selectedAppID = nil
    }

    let startTime = CFAbsoluteTimeGetCurrent()
    let apps = await scanner.scan(
      roots: settings.allScanRootURLs,
      serverDismissedBundleIds: settings.serverDismissedBundleIds
    )
    let scanMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)

    installedApps = apps
    rebuildLookupTables()
    loadState = .submitting

    // Run backend + local checks in parallel
    let perApp = settings.perAppChannels
    let channelPrefs =
      perApp.isEmpty && settings.defaultChannel == "stable"
      ? nil
      : InventoryCheckRequest.ChannelPreferences(
        defaultChannel: settings.defaultChannel,
        perApp: perApp
      )
    async let sparkleTask = sparkleChecker.checkAll(apps: apps)
    async let electronTask = electronChecker.checkAll(apps: apps)
    async let appStoreTask = appStoreChecker.checkAll(apps: apps)
    async let homebrewTask = homebrewChecker.checkAll(apps: apps)

    let appStoreResults = await appStoreTask

    // Enrich installed apps with confirmed App Store IDs from iTunes API
    for (index, app) in installedApps.enumerated() {
      if let storeResult = appStoreResults[app.localID], app.masAppId == nil {
        installedApps[index] = app.withMasAppId(storeResult.masAppId)
      }
    }
    rebuildLookupTables()

    let sparkleResults = await sparkleTask
    let electronResults = await electronTask
    let homebrewResults = await homebrewTask

    let localResults = buildLocalUpdateMap(
      sparkle: sparkleResults,
      electron: electronResults,
      appStore: appStoreResults,
      homebrew: homebrewResults,
      apps: installedApps
    )

    do {
      let response = try await apiClient.checkInventory(
        apps: installedApps,
        scanDurationMs: scanMs,
        channelPreferences: channelPrefs
      )
      if let skipped = response.skipped, !skipped.isEmpty {
        Logger.api.warning("Server skipped \(skipped.count) app(s) due to validation errors")
        for app in skipped {
          Logger.api.debug(
            "Skipped: \(app.appName ?? "index \(app.index)") — \(app.reasons.joined(separator: ", "))"
          )
        }
      }
      rawInventoryResults = mergeResults(
        backend: response.results,
        local: localResults,
        apps: installedApps
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
      Logger.api.warning(
        "API request failed, using local results only: \(error.localizedDescription)")
      if !localResults.isEmpty {
        rawInventoryResults = buildLocalOnlyResults(local: localResults, apps: installedApps)
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

  private enum LocalUpdateSourceKind: Int {
    case versionOnly
    case electron
    case sparkle
    case homebrew
    case appStore
  }

  /// Unified local update info from any checker (Sparkle, Electron, MAS, Homebrew).
  private struct LocalUpdateCandidate {
    let sourceKind: LocalUpdateSourceKind
    let latestVersion: String?
    let publishedAt: String?
    let artifact: AppDecision.Artifact?
    let installStrategy: InstallStrategy?
    let updateDetected: Bool
  }

  /// Combines Sparkle, Electron, MAS, and Homebrew results into a single lookup by local app ID.
  private func buildLocalUpdateMap(
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
  private func mergeResults(
    backend: [AppDecision],
    local: [String: LocalUpdateCandidate],
    apps: [InstalledApp]
  ) -> [AppDecision] {
    var results = bindInstalledApps(to: backend, apps: apps)

    for (index, decision) in results.enumerated() {
      let matchingApp = findInstalledApp(for: decision, in: apps)

      // For unmatched apps, try local version data
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
  private func buildLocalOnlyResults(
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

  private func bindInstalledApps(
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

    func claimFirstMatching(
      from candidates: [InstalledApp]
    ) -> InstalledApp? {
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

  /// Finds the InstalledApp that corresponds to a backend AppDecision.
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
      await performPrimaryUpdate(for: target)
    }
  }

  func canPerformPrimaryUpdate(
    for result: AppDecision,
    installState: InstallCoordinator.OperationState? = nil
  ) -> Bool {
    let currentState = installState ?? installCoordinator.state(for: result)
    guard result.decision == .updateAvailable, currentState.phase == .idle else { return false }
    let presentation = primaryActionPresentation(for: result, installState: currentState)
    return presentation.kind.performsUpdate && !presentation.isDisabled
  }

  func primaryActionPresentation(
    for result: AppDecision,
    installState: InstallCoordinator.OperationState? = nil
  ) -> PrimaryAppActionPresentation {
    let currentState = installState ?? installCoordinator.state(for: result)
    return PrimaryAppActionPresentation.make(
      result: result,
      installState: currentState,
      isUserIgnored: isUserIgnored(result),
      isHomebrewInstalled: isHomebrewInstalled(for: result),
      isMasUpgradeable: isMasUpgradeable(for: result),
      hasAppPath: appPathText(for: result) != nil,
      manualUpdateAction: manualUpdateAction(for: result)
    )
  }

  func performPrimaryUpdate(for result: AppDecision) async {
    let presentation = primaryActionPresentation(for: result)
    guard presentation.kind.performsUpdate, !presentation.isDisabled else { return }
    switch presentation.kind {
    case .masUpgrade:
      await masUpgrade(result)
    case .brewUpgrade:
      await brewUpgrade(result)
    case .install:
      await install(result)
    case .manualUpdate:
      openManualUpdate(result)
    case .stopIgnoring, .openApp, .unavailable:
      return
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

  func primaryActionTitle(for result: AppDecision) -> String {
    primaryActionPresentation(for: result).title
  }

  func primaryActionCompactTitle(for result: AppDecision) -> String {
    primaryActionPresentation(for: result).compactTitle
  }

  func manualUpdateAction(for result: AppDecision) -> ManualUpdateAction? {
    guard result.decision == .updateAvailable else { return nil }
    guard let installedApp = installedApp(for: result) else { return nil }

    if installedApp.isMasApp,
      let masAppId = installedApp.masAppId,
      !settings.isMasCliAvailable,
      let storeURL = URL(string: "https://apps.apple.com/app/id\(masAppId)")
    {
      return ManualUpdateAction(
        title: "Open App Store Listing",
        detail: "Versioneer found an App Store update, but `mas` is not configured on this Mac.",
        url: storeURL
      )
    }

    if let downloadURLString = result.artifact?.downloadUrl,
      let downloadURL = URL(string: downloadURLString)
    {
      return ManualUpdateAction(
        title: "Open Download",
        detail:
          "Versioneer found a downloadable update, but this Mac does not meet the trust requirements for one-click install.",
        url: downloadURL
      )
    }

    if let updateURLString = installedApp.electronUpdateUrl,
      let updateURL = URL(string: updateURLString)
    {
      return ManualUpdateAction(
        title: "Open Update Feed",
        detail:
          "Versioneer found a local Electron update source but could not derive a trusted automatic install route.",
        url: updateURL
      )
    }

    if let feedURLString = installedApp.sparkleFeedUrl,
      let feedURL = URL(string: feedURLString)
    {
      return ManualUpdateAction(
        title: "Open Appcast",
        detail:
          "Versioneer found a Sparkle feed for this app but could not use it for an automatic install.",
        url: feedURL
      )
    }

    return nil
  }

  func openManualUpdate(_ result: AppDecision) {
    guard let action = manualUpdateAction(for: result) else { return }
    NSWorkspace.shared.open(action.url)
  }

  func refreshDisplayedResults(preservingSelectionID selectionID: String? = nil) {
    let preferredSelectionID = selectionID ?? selectedAppID
    rebuildLookupTables()
    rawInventoryResults = bindInstalledApps(to: rawInventoryResults, apps: installedApps)
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
