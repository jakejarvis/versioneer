import AppKit
import Foundation
import Observation
import UniformTypeIdentifiers

/// Top-level shared application state.
@Observable
@MainActor
final class AppState {
    // MARK: - Services

    let settings = SettingsStore()
    let scanner = AppScanner()
    let sparkleChecker = SparkleChecker()
    let electronChecker = ElectronChecker()
    private let cacheStore = ScanCacheStore()

    var apiClient: InventoryAPIClient {
        InventoryAPIClient(baseURL: settings.baseURL)
    }

    var feedbackClient: FeedbackAPIClient {
        FeedbackAPIClient(baseURL: settings.baseURL)
    }

    // MARK: - Navigation

    enum SidebarSection: String, CaseIterable, Identifiable {
        case all = "All Apps"
        case updatesAvailable = "Updates Available"
        case unsupported = "Unsupported"
        case unknown = "Unknown"

        var id: String { rawValue }

        var systemImage: String {
            switch self {
            case .all: "app.dashed"
            case .updatesAvailable: "arrow.up.circle"
            case .unsupported: "xmark.circle"
            case .unknown: "questionmark.circle"
            }
        }
    }

    var selectedSection: SidebarSection = .all
    var selectedResult: AppDecision?

    // MARK: - Data

    var installedApps: [InstalledApp] = []
    var inventoryResults: [AppDecision] = []
    var snapshotId: String?
    var searchText: String = ""

    /// Path lookup tables built after each scan, keyed by bundle ID or app name.
    private var appPathsByBundleId: [String: String] = [:]
    private var appPathsByName: [String: String] = [:]

    /// Icon cache to avoid re-loading from disk on every view redraw.
    private var iconCache: [String: NSImage] = [:]

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

    init() {
        if let cached = cacheStore.load() {
            installedApps = cached.installedApps
            inventoryResults = cached.inventoryResults
            snapshotId = cached.snapshotId
            loadState = .done
            rebuildLookupTables()
        }
    }

    /// Whether we have cached inventory results to display while rescanning.
    var hasCachedResults: Bool {
        !inventoryResults.isEmpty
    }

    // MARK: - Computed filtered results

    var filteredResults: [AppDecision] {
        let sectionFiltered: [AppDecision]
        switch selectedSection {
        case .all:
            sectionFiltered = inventoryResults
        case .updatesAvailable:
            sectionFiltered = inventoryResults.filter { $0.decision == .updateAvailable }
        case .unsupported:
            sectionFiltered = inventoryResults.filter { $0.decision == .unsupported || $0.decision == .ignored }
        case .unknown:
            sectionFiltered = inventoryResults.filter { $0.decision == .unknown || $0.decision == .ambiguous }
        }

        guard !searchText.isEmpty else { return sectionFiltered }
        return sectionFiltered.filter { result in
            result.appName.localizedCaseInsensitiveContains(searchText)
            || (result.bundleId?.localizedCaseInsensitiveContains(searchText) ?? false)
            || (result.matchedAppName?.localizedCaseInsensitiveContains(searchText) ?? false)
        }
    }

    // MARK: - Badge counts

    func badgeCount(for section: SidebarSection) -> Int? {
        switch section {
        case .updatesAvailable:
            let count = inventoryResults.filter { $0.decision == .updateAvailable }.count
            return count > 0 ? count : nil
        case .unknown:
            let count = inventoryResults.filter { $0.decision == .unknown || $0.decision == .ambiguous }.count
            return count > 0 ? count : nil
        default:
            return nil
        }
    }

    // MARK: - Actions

    /// Rebuilds path lookup tables from the current `installedApps` array.
    private func rebuildLookupTables() {
        appPathsByBundleId = [:]
        appPathsByName = [:]
        for app in installedApps {
            if let bundleId = app.bundleId {
                appPathsByBundleId[bundleId] = app.path
            }
            appPathsByName[app.name] = app.path
        }
    }

    /// Returns the locally extracted icon for an app decision, or a generic app icon.
    func appIcon(for result: AppDecision) -> NSImage {
        let cacheKey = result.appName + (result.bundleId ?? "")
        if let cached = iconCache[cacheKey] { return cached }

        let path: String? = if let bundleId = result.bundleId {
            appPathsByBundleId[bundleId]
        } else {
            appPathsByName[result.appName]
        }

        let icon: NSImage = if let path {
            NSWorkspace.shared.icon(forFile: path)
        } else {
            NSWorkspace.shared.icon(for: .applicationBundle)
        }

        iconCache[cacheKey] = icon
        return icon
    }

    func scanAndSubmit() async {
        loadState = .scanning
        if !hasCachedResults {
            selectedResult = nil
        }

        let startTime = CFAbsoluteTimeGetCurrent()
        let apps = await scanner.scan()
        let scanMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)

        installedApps = apps
        iconCache = [:]
        rebuildLookupTables()
        loadState = .submitting

        // Run backend + local checks in parallel
        async let backendTask = apiClient.checkInventory(apps: apps, scanDurationMs: scanMs)
        async let sparkleTask = sparkleChecker.checkAll(apps: apps)
        async let electronTask = electronChecker.checkAll(apps: apps)

        let sparkleResults = await sparkleTask
        let electronResults = await electronTask
        let localResults = buildLocalVersionMap(sparkle: sparkleResults, electron: electronResults)

        do {
            let response = try await backendTask
            inventoryResults = mergeResults(
                backend: response.results,
                local: localResults,
                apps: apps
            )
            snapshotId = response.snapshotId
            loadState = .done
            cacheStore.save(ScanCacheStore.CachedScanData(
                installedApps: installedApps,
                inventoryResults: inventoryResults,
                snapshotId: response.snapshotId
            ))
        } catch {
            // Backend failed — fall back to local results if we have any
            if !localResults.isEmpty {
                inventoryResults = buildLocalOnlyResults(local: localResults, apps: apps)
                snapshotId = nil
                loadState = .done
                cacheStore.save(ScanCacheStore.CachedScanData(
                    installedApps: installedApps,
                    inventoryResults: inventoryResults,
                    snapshotId: nil
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

    /// Combines Sparkle and Electron results into a single lookup by app ID.
    private func buildLocalVersionMap(
        sparkle: [String: SparkleChecker.SparkleResult],
        electron: [String: ElectronChecker.ElectronResult]
    ) -> [String: LocalVersionInfo] {
        var map: [String: LocalVersionInfo] = [:]
        for (id, result) in sparkle {
            map[id] = LocalVersionInfo(latestVersion: result.latestVersion, publishedAt: result.publishedAt)
        }
        for (id, result) in electron where map[id] == nil {
            map[id] = LocalVersionInfo(latestVersion: result.latestVersion, publishedAt: result.publishedAt)
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

            // Flag MAS apps that the backend doesn't know about
            if let matchingApp, matchingApp.isMasApp,
               decision.decision == .unknown || decision.decision == .unsupported
            {
                results[index] = decision.replacing(decision: .ignored)
                continue
            }

            // For unmatched apps, try local version data
            guard decision.decision == .unknown || decision.decision == .unsupported else { continue }
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
                latestVersion: localInfo.latestVersion ?? decision.latestVersion,
                latestVersionRaw: localInfo.latestVersion ?? decision.latestVersionRaw,
                releasedAt: localInfo.publishedAt ?? decision.releasedAt,
                artifact: nil
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

            if app.isMasApp {
                decision = .ignored
                latestVersion = nil
                releasedAt = nil
            } else if let info = local[app.id] {
                decision = decisionFromVersion(latest: info.latestVersion, installed: app.version)
                latestVersion = info.latestVersion
                releasedAt = info.publishedAt
            } else {
                decision = .unknown
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
                latestVersion: latestVersion,
                latestVersionRaw: latestVersion,
                releasedAt: releasedAt,
                artifact: nil
            )
        }
    }

    /// Finds the InstalledApp that corresponds to a backend AppDecision.
    private func findInstalledApp(for decision: AppDecision, in apps: [InstalledApp]) -> InstalledApp? {
        if let bundleId = decision.bundleId {
            return apps.first { $0.bundleId == bundleId }
        }
        return apps.first { $0.name == decision.appName }
    }

    /// Determines update decision by comparing version strings.
    private func decisionFromVersion(latest: String?, installed: String?) -> AppDecision.Decision {
        guard let latest, let installed else { return .unknown }
        if latest == installed { return .upToDate }
        if compareVersionStrings(latest, isNewerThan: installed) {
            return .updateAvailable
        }
        return .upToDate
    }

    /// Returns true if `a` is a newer version than `b` using numeric component comparison.
    private func compareVersionStrings(_ a: String, isNewerThan b: String) -> Bool {
        let aParts = a.split(separator: ".").compactMap { Int($0) }
        let bParts = b.split(separator: ".").compactMap { Int($0) }

        for i in 0..<max(aParts.count, bParts.count) {
            let av = i < aParts.count ? aParts[i] : 0
            let bv = i < bParts.count ? bParts[i] : 0
            if av > bv { return true }
            if av < bv { return false }
        }
        return false // equal
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

    func submitWrongVersion(for result: AppDecision, reportedVersion: String?, comment: String?) async throws {
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

    func submitMissingApp(for result: AppDecision, homepageUrl: String?, comment: String?) async throws {
        let feedback = FeedbackRequest.MissingApp(
            appName: result.appName,
            bundleId: result.bundleId,
            homepageUrl: homepageUrl,
            comment: comment
        )
        try await feedbackClient.submitMissingApp(feedback)
    }
}
