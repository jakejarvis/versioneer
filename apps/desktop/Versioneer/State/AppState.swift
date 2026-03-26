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

        // Run backend inventory check and local Sparkle checks in parallel
        async let backendTask = apiClient.checkInventory(apps: apps, scanDurationMs: scanMs)
        async let sparkleTask = sparkleChecker.checkAll(apps: apps)

        let sparkleResults = await sparkleTask

        do {
            let response = try await backendTask
            inventoryResults = mergeResults(
                backend: response.results,
                sparkle: sparkleResults,
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
            // Backend failed — fall back to local Sparkle results if we have any
            if !sparkleResults.isEmpty {
                inventoryResults = buildSparkleOnlyResults(
                    sparkle: sparkleResults,
                    apps: apps
                )
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

    /// Merges backend decisions with local Sparkle results.
    /// Backend takes precedence for matched apps; local Sparkle fills in unknown/unmatched apps.
    private func mergeResults(
        backend: [AppDecision],
        sparkle: [String: SparkleChecker.SparkleResult],
        apps: [InstalledApp]
    ) -> [AppDecision] {
        var results = backend

        // For apps the backend didn't match, substitute local Sparkle data
        for (index, decision) in results.enumerated() {
            guard decision.decision == .unknown || decision.decision == .unsupported else { continue }

            let appId = decision.appName + (decision.bundleId ?? "")
            // Try to find the matching installed app to get its id for Sparkle lookup
            let matchingApp = apps.first { $0.id == decision.bundleId || $0.id == appId }
            guard let matchingApp, let sparkleResult = sparkle[matchingApp.id] else { continue }

            results[index] = AppDecision(
                appName: decision.appName,
                bundleId: decision.bundleId,
                installedVersion: decision.installedVersion,
                matchedAppId: decision.matchedAppId,
                matchedAppName: decision.matchedAppName,
                matchConfidence: decision.matchConfidence,
                decision: decisionFromSparkle(
                    sparkleResult,
                    installedVersion: decision.installedVersion
                ),
                latestVersion: sparkleResult.latestVersion ?? decision.latestVersion,
                latestVersionRaw: sparkleResult.latestVersion ?? decision.latestVersionRaw,
                releasedAt: sparkleResult.publishedAt ?? decision.releasedAt
            )
        }

        return results
    }

    /// Builds AppDecision entries purely from local Sparkle results when the backend is unavailable.
    private func buildSparkleOnlyResults(
        sparkle: [String: SparkleChecker.SparkleResult],
        apps: [InstalledApp]
    ) -> [AppDecision] {
        apps.map { app in
            if let result = sparkle[app.id] {
                AppDecision(
                    appName: app.name,
                    bundleId: app.bundleId,
                    installedVersion: app.version,
                    matchedAppId: nil,
                    matchedAppName: nil,
                    matchConfidence: nil,
                    decision: decisionFromSparkle(result, installedVersion: app.version),
                    latestVersion: result.latestVersion,
                    latestVersionRaw: result.latestVersion,
                    releasedAt: result.publishedAt
                )
            } else {
                AppDecision(
                    appName: app.name,
                    bundleId: app.bundleId,
                    installedVersion: app.version,
                    matchedAppId: nil,
                    matchedAppName: nil,
                    matchConfidence: nil,
                    decision: .unknown,
                    latestVersion: nil,
                    latestVersionRaw: nil,
                    releasedAt: nil
                )
            }
        }
    }

    /// Determines the update decision by comparing installed version to what Sparkle reports.
    private func decisionFromSparkle(
        _ result: SparkleChecker.SparkleResult,
        installedVersion: String?
    ) -> AppDecision.Decision {
        guard let latest = result.latestVersion, let installed = installedVersion else {
            return .unknown
        }
        if latest == installed { return .upToDate }
        // Simple numeric comparison: if latest > installed, update available
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
