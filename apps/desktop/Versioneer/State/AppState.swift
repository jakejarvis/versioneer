import Foundation
import Observation

/// Top-level shared application state.
@Observable
@MainActor
final class AppState {
    // MARK: - Services

    let settings = SettingsStore()
    let scanner = AppScanner()

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
        case settings = "Settings"

        var id: String { rawValue }

        var systemImage: String {
            switch self {
            case .all: "app.dashed"
            case .updatesAvailable: "arrow.up.circle"
            case .unsupported: "xmark.circle"
            case .unknown: "questionmark.circle"
            case .settings: "gear"
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

    // MARK: - Loading state

    enum LoadState: Equatable {
        case idle
        case scanning
        case submitting
        case done
        case error(String)
    }

    var loadState: LoadState = .idle

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
        case .settings:
            sectionFiltered = []
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

    func scanAndSubmit() async {
        loadState = .scanning
        selectedResult = nil

        let startTime = CFAbsoluteTimeGetCurrent()
        let apps = await scanner.scan()
        let scanMs = Int((CFAbsoluteTimeGetCurrent() - startTime) * 1000)

        installedApps = apps
        loadState = .submitting

        do {
            let response = try await apiClient.checkInventory(apps: apps, scanDurationMs: scanMs)
            inventoryResults = response.results
            snapshotId = response.snapshotId
            loadState = .done
        } catch {
            loadState = .error(error.localizedDescription)
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
