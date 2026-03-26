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

        state.inventoryResults = [unknown, stable, update]
        state.installedApps = [unknown, stable, update].map(DesktopUITestFixtures.makeInstalledApp)
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

        state.inventoryResults = [update, unknown, ambiguous, supported]
        state.selectedSection = .unknown

        #expect(state.badgeCount(for: .updatesAvailable) == 1)
        #expect(state.badgeCount(for: .unknown) == 2)
        #expect(state.filteredResults.map(\.id) == [unknown.id, ambiguous.id])

        state.searchText = "Utility"

        #expect(state.filteredResults.map(\.id) == [ambiguous.id])
        #expect(state.scanSummary.updatesAvailableCount == 1)
        #expect(state.scanSummary.unknownCount == 2)
    }
}
