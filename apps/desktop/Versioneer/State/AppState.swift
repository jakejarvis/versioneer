import AppKit
import Foundation
import Logging
import Observation
import UniformTypeIdentifiers

nonisolated struct ReleaseNotesContent: Equatable, Sendable {
  let markdown: String?
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

  enum InstallConfirmationRequest: Equatable {
    case none
    case installAll
    case installResult(String)
  }

  private let cacheStore: ScanCacheStore
  @ObservationIgnored private var directoryWatcher: DirectoryWatcher?

  var apiClient: InventoryAPIClient {
    InventoryAPIClient(baseURL: settings.baseURL)
  }

  var feedbackClient: FeedbackAPIClient {
    FeedbackAPIClient(baseURL: settings.baseURL)
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
  var rawInventoryResults: [InventoryResult] = []
  var inventoryResults: [InventoryResult] = []
  var userIgnoredResultIDs: Set<String> = []
  var searchText: String = ""
  var lastScanCompletedAt: Date?

  /// Installed app lookup tables for O(1) access.
  private var installedAppsByID: [String: InstalledApp] = [:]
  private var installedAppsByBundleId: [String: InstalledApp] = [:]
  private var installedAppsByName: [String: [InstalledApp]] = [:]

  /// Inventory results indexed by ID for O(1) lookups.
  private(set) var inventoryResultsByID: [String: InventoryResult] = [:]

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
  let liveServicesEnabled: Bool

  // MARK: - Init

  init(
    settings: SettingsStore = SettingsStore(),
    cacheStore: ScanCacheStore = ScanCacheStore(),
    enableLiveServices: Bool = true
  ) {
    self.settings = settings
    self.cacheStore = cacheStore
    self.liveServicesEnabled = enableLiveServices
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

    if enableLiveServices {
      configureDirectoryWatcher()
      PostHogTelemetry.configureIfNeeded(
        analyticsEnabled: settings.analyticsEnabled,
        crashReportingEnabled: settings.crashReportingEnabled
      )
      PostHogTelemetry.capture(
        "desktop_app_launched",
        properties: [
          "has_cached_results": hasCachedResults
        ]
      )
    }
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

  var updatableResults: [InventoryResult] {
    inventoryResults.filter { $0.decision == .updateAvailable && !isUserIgnored($0) }
  }

  var visibleUpdateCount: Int {
    updatableResults.count
  }

  var selectedResult: InventoryResult? {
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

  var filteredResults: [InventoryResult] {
    let sectionFiltered: [InventoryResult]
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

  private func telemetryProperties(for result: InventoryResult) -> [String: Any] {
    [
      "decision": result.decision.rawValue,
      "tracking_state": result.trackingState.rawValue,
      "install_strategy": result.installStrategy?.rawValue ?? "none",
      "install_trust": result.installTrust.status.rawValue,
      "requires_admin": result.installStrategy?.requiresAdmin ?? false,
      "has_catalog_match": result.matchedAppId != nil,
      "has_artifact": result.artifact != nil,
      "is_local_only": result.isLocalOnly,
    ]
  }

  private func telemetryActionKind(_ kind: PrimaryAppActionKind) -> String {
    switch kind {
    case .stopIgnoring: "stop_ignoring"
    case .openApp: "open_app"
    case .install: "install"
    case .masUpgrade: "mas_upgrade"
    case .brewUpgrade: "brew_upgrade"
    case .manualUpdate: "manual_update"
    case .unavailable: "unavailable"
    }
  }

  private func scanTelemetryProperties(scanDurationMs: Int) -> [String: Any] {
    [
      "scan_duration_ms": scanDurationMs,
      "installed_app_count": installedApps.count,
      "result_count": inventoryResults.count,
      "updates_available_count": scanSummary.updatesAvailableCount,
      "local_only_count": scanSummary.localOnlyCount,
      "needs_review_count": scanSummary.needsReviewCount,
      "ignored_count": scanSummary.ignoredCount,
    ]
  }

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

    PostHogTelemetry.capture(
      "desktop_bulk_install_requested",
      properties: [
        "update_count": updatableResults.count,
        "confirmation_required": settings.confirmInstallAll,
      ]
    )

    if settings.confirmInstallAll {
      pendingInstallConfirmation = .installAll
    } else {
      Task { await installAll() }
    }
  }

  func requestPrimaryUpdate(for result: InventoryResult) {
    guard canPerformPrimaryUpdate(for: result) else { return }

    var properties = telemetryProperties(for: result)
    properties["confirmation_required"] =
      settings.confirmPrivilegedInstall && (result.installStrategy?.requiresAdmin ?? false)
    PostHogTelemetry.capture("desktop_install_requested", properties: properties)

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
    PostHogTelemetry.configureIfNeeded(
      analyticsEnabled: settings.analyticsEnabled,
      crashReportingEnabled: settings.crashReportingEnabled
    )
    PostHogTelemetry.capture(
      "desktop_privacy_setting_changed",
      properties: [
        "setting": "analytics",
        "enabled": enabled,
      ]
    )
  }

  func setCrashReportingEnabled(_ enabled: Bool) {
    settings.crashReportingEnabled = enabled
    PostHogTelemetry.configureIfNeeded(
      analyticsEnabled: settings.analyticsEnabled,
      crashReportingEnabled: settings.crashReportingEnabled
    )
    PostHogTelemetry.capture(
      "desktop_privacy_setting_changed",
      properties: [
        "setting": "crash_reporting",
        "enabled": enabled,
      ]
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

  /// Returns the locally extracted icon for an inventory result, or a generic app icon.
  func appIcon(for result: InventoryResult) -> NSImage {
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

  func installedApp(for result: InventoryResult) -> InstalledApp? {
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

  func bundleIdText(for result: InventoryResult) -> String? {
    installedApp(for: result)?.bundleId ?? result.bundleId
  }

  func appPathText(for result: InventoryResult) -> String? {
    installedApp(for: result)?.path
  }

  func installedApp(matching rule: IgnoredAppRule) -> InstalledApp? {
    installedApps.first(where: rule.matches)
  }

  func ignoredAppRules(matching result: InventoryResult) -> [IgnoredAppRule] {
    guard let installedApp = installedApp(for: result) else { return [] }
    return settings.ignoredAppRules.filter { $0.matches(installedApp) }
  }

  func isUserIgnored(_ result: InventoryResult) -> Bool {
    userIgnoredResultIDs.contains(result.id)
  }

  func ignore(_ result: InventoryResult, undoManager: UndoManager? = nil) {
    guard let installedApp = installedApp(for: result) else { return }
    let rule = IgnoredAppRule.make(from: installedApp)
    PostHogTelemetry.capture("desktop_result_ignored", properties: telemetryProperties(for: result))

    withUndo("Ignore \(result.appName)", undoManager: undoManager) { state in
      state.settings.addIgnoredAppRule(rule)
      state.refreshDisplayedResults()
    } reverse: { state in
      state.settings.removeIgnoredAppRule(rule)
      state.refreshDisplayedResults()
    }
  }

  func unignore(_ result: InventoryResult, undoManager: UndoManager? = nil) {
    let rules = ignoredAppRules(matching: result)
    let ruleIDs = Set(rules.map(\.id))
    guard !ruleIDs.isEmpty else { return }
    PostHogTelemetry.capture(
      "desktop_result_unignored", properties: telemetryProperties(for: result))

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

  func openApp(_ result: InventoryResult) {
    guard let installedApp = installedApp(for: result) else { return }

    let configuration = NSWorkspace.OpenConfiguration()
    NSWorkspace.shared.openApplication(
      at: URL(fileURLWithPath: installedApp.path),
      configuration: configuration
    ) { _, error in
      if let error {
        Logger.app.error("Failed to open app \(installedApp.name): \(error.localizedDescription)")
        Task { @MainActor in
          PostHogTelemetry.captureException(
            error,
            properties: [
              "operation": "open_app"
            ]
          )
        }
      }
    }
  }

  func revealAppInFinder(_ result: InventoryResult) {
    guard let path = appPathText(for: result) else { return }
    NSWorkspace.shared.activateFileViewerSelecting([URL(fileURLWithPath: path)])
  }

  func copyBundleId(_ result: InventoryResult) {
    guard let bundleId = bundleIdText(for: result) else { return }
    copyToPasteboard(bundleId)
  }

  func copyAppPath(_ result: InventoryResult) {
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
      PostHogTelemetry.captureException(
        error,
        properties: [
          "operation": "load_preflight"
        ]
      )
    }
  }

  func scanAndSubmit() async {
    guard loadState != .scanning && loadState != .submitting else { return }

    PostHogTelemetry.capture(
      "desktop_scan_started",
      properties: [
        "root_count": settings.allScanRootURLs.count,
        "has_cached_results": hasCachedResults,
      ]
    )
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
      : InventoryCheckRequest.Channels(
        defaultChannel: settings.defaultChannel,
        overrides: perApp
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
        channels: channelPrefs
      )
      let iconUpload = response.iconUpload
      let iconUploadApps = installedApps
      let iconUploadClient = apiClient
      if !response.issues.invalidApps.isEmpty {
        Logger.api.warning(
          "Server rejected \(response.issues.invalidApps.count) app(s) due to validation errors")
        for app in response.issues.invalidApps {
          Logger.api.debug(
            "Rejected: \(app.appName ?? "index \(app.index)") — \(app.reasons.joined(separator: ", "))"
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
      PostHogTelemetry.capture(
        "desktop_scan_completed",
        properties: scanTelemetryProperties(scanDurationMs: scanMs)
      )
      cacheStore.save(
        ScanCacheStore.CachedScanData(
          installedApps: installedApps,
          inventoryResults: rawInventoryResults
        ))
      if let iconUpload, !iconUpload.items.isEmpty {
        Task(priority: .utility) {
          await iconUploadClient.uploadRequestedIcons(iconUpload, from: iconUploadApps)
        }
      }
    } catch {
      // Backend failed — fall back to local results if we have any
      Logger.api.warning(
        "API request failed, using local results only: \(error.localizedDescription)")
      PostHogTelemetry.captureException(
        error,
        properties: [
          "operation": "scan_submit",
          "scan_duration_ms": scanMs,
          "local_result_count": localResults.count,
        ]
      )
      if !localResults.isEmpty {
        rawInventoryResults = buildLocalOnlyResults(local: localResults, apps: installedApps)
        loadState = .done
        lastScanCompletedAt = Date()
        refreshDisplayedResults(preservingSelectionID: previousSelectionID)
        PostHogTelemetry.capture(
          "desktop_scan_fell_back_to_local_results",
          properties: scanTelemetryProperties(scanDurationMs: scanMs).merging(
            ["local_result_count": localResults.count]
          ) { _, new in new }
        )
        cacheStore.save(
          ScanCacheStore.CachedScanData(
            installedApps: installedApps,
            inventoryResults: rawInventoryResults
          ))
      } else {
        loadState = .error(error.localizedDescription)
        PostHogTelemetry.capture(
          "desktop_scan_failed",
          properties: [
            "scan_duration_ms": scanMs
          ]
        )
      }
    }
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
        markdown: response.releaseNotesMarkdown,
        html: response.releaseNotesHtml,
        url: Self.safeExternalURL(from: response.releaseNotesUrl)
      )
      releaseNotesCache[releaseId] = content
      return content
    } catch {
      Logger.api.error(
        "Failed to fetch release notes for \(releaseId): \(error.localizedDescription)")
      PostHogTelemetry.captureException(
        error,
        properties: [
          "operation": "fetch_release_notes"
        ]
      )
      releaseNotesCache[releaseId] = nil
      return nil
    }
  }

  func submitWrongMatch(for result: InventoryResult, comment: String?) async throws {
    guard let matchedAppId = result.matchedAppId else { return }
    let feedback = FeedbackRequest.WrongMatch(
      appName: result.appName,
      bundleId: result.bundleId,
      matchedAppId: matchedAppId,
      comment: comment
    )
    try await feedbackClient.submitWrongMatch(feedback)
    PostHogTelemetry.capture(
      "desktop_feedback_submitted",
      properties: [
        "feedback_type": "wrong_match",
        "has_comment": comment?.isEmpty == false,
      ]
    )
  }

  func submitWrongVersion(for result: InventoryResult, reportedVersion: String?, comment: String?)
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
    PostHogTelemetry.capture(
      "desktop_feedback_submitted",
      properties: [
        "feedback_type": "wrong_version",
        "has_comment": comment?.isEmpty == false,
        "has_reported_version": reportedVersion?.isEmpty == false,
      ]
    )
  }

  func submitMissingApp(for result: InventoryResult, homepageUrl: String?, comment: String?)
    async throws
  {
    let feedback = FeedbackRequest.MissingApp(
      appName: result.appName,
      bundleId: result.bundleId,
      homepageUrl: homepageUrl,
      comment: comment
    )
    try await feedbackClient.submitMissingApp(feedback)
    PostHogTelemetry.capture(
      "desktop_feedback_submitted",
      properties: [
        "feedback_type": "missing_app",
        "has_comment": comment?.isEmpty == false,
        "has_homepage_url": homepageUrl?.isEmpty == false,
      ]
    )
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
    for result: InventoryResult,
    installState: InstallCoordinator.OperationState? = nil
  ) -> Bool {
    let currentState = installState ?? installCoordinator.state(for: result)
    guard result.decision == .updateAvailable, currentState.phase == .idle else { return false }
    let presentation = primaryActionPresentation(for: result, installState: currentState)
    return presentation.kind.performsUpdate && !presentation.isDisabled
  }

  func primaryActionPresentation(
    for result: InventoryResult,
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

  func performPrimaryUpdate(for result: InventoryResult) async {
    let presentation = primaryActionPresentation(for: result)
    guard presentation.kind.performsUpdate, !presentation.isDisabled else { return }
    var properties = telemetryProperties(for: result)
    properties["action_kind"] = telemetryActionKind(presentation.kind)
    PostHogTelemetry.capture("desktop_install_started", properties: properties)
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

  func install(_ result: InventoryResult) async {
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

  /// Triggers a Homebrew Cask upgrade for the given inventory result.
  /// Uses the cask token from the local InstalledApp (primary) or the server response (fallback).
  func brewUpgrade(_ result: InventoryResult) async {
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
  func isHomebrewInstalled(for result: InventoryResult) -> Bool {
    installedApp(for: result)?.isHomebrewInstalled ?? false
  }

  /// Returns the Homebrew cask token for the given result, from local detection or server.
  func homebrewCaskToken(for result: InventoryResult) -> String? {
    installedApp(for: result)?.homebrewCaskToken ?? result.homebrewCaskToken
  }

  /// Triggers a mas-cli upgrade for the given inventory result.
  func masUpgrade(_ result: InventoryResult) async {
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
  func isMasUpgradeable(for result: InventoryResult) -> Bool {
    guard let app = installedApp(for: result) else { return false }
    return app.isMasApp && app.masAppId != nil && settings.isMasCliAvailable
  }

  func primaryActionTitle(for result: InventoryResult) -> String {
    primaryActionPresentation(for: result).title
  }

  func primaryActionCompactTitle(for result: InventoryResult) -> String {
    primaryActionPresentation(for: result).compactTitle
  }

  func manualUpdateAction(for result: InventoryResult) -> ManualUpdateAction? {
    guard result.decision == .updateAvailable else { return nil }
    guard let installedApp = installedApp(for: result) else { return nil }

    if installedApp.isMasApp,
      let masAppId = installedApp.masAppId,
      !settings.isMasCliAvailable,
      let storeURL = Self.safeExternalURL(from: "https://apps.apple.com/app/id\(masAppId)")
    {
      return ManualUpdateAction(
        title: "Open App Store Listing",
        detail: "Versioneer found an App Store update, but `mas` is not configured on this Mac.",
        url: storeURL
      )
    }

    if let downloadURLString = result.artifact?.downloadUrl,
      let downloadURL = Self.safeExternalURL(from: downloadURLString)
    {
      return ManualUpdateAction(
        title: "Open Download",
        detail:
          "Versioneer found a downloadable update, but this Mac does not meet the trust requirements for one-click install.",
        url: downloadURL
      )
    }

    if let updateURLString = installedApp.electronUpdateUrl,
      let updateURL = Self.safeExternalURL(from: updateURLString)
    {
      return ManualUpdateAction(
        title: "Open Update Feed",
        detail:
          "Versioneer found a local Electron update source but could not derive a trusted automatic install route.",
        url: updateURL
      )
    }

    if let feedURLString = installedApp.sparkleFeedUrl,
      let feedURL = Self.safeExternalURL(from: feedURLString)
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

  private static func safeExternalURL(from string: String?) -> URL? {
    guard let string,
      let url = URL(string: string),
      let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      url.host != nil
    else {
      return nil
    }
    return url
  }

  func openManualUpdate(_ result: InventoryResult) {
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
