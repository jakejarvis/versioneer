import SwiftUI

/// The main three-column layout: sidebar, results list, detail.
struct RootView: View {
    @State private var appState = AppState()

    var body: some View {
        NavigationSplitView {
            SidebarView()
        } content: {
            ResultsListView()
        } detail: {
            if let selected = appState.selectedResult {
                AppDetailView(result: selected)
            } else {
                EmptyStateView()
            }
        }
        .environment(appState)
        .environment(appState.installCoordinator)
        .frame(minWidth: 900, minHeight: 500)
        .task {
            if appState.settings.scanOnLaunch {
                await Task.yield()
                await appState.scanAndSubmit()
            }
        }
    }
}
