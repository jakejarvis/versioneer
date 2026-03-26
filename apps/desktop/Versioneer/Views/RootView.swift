import SwiftUI

/// The main three-column layout: sidebar, results list, detail.
struct RootView: View {
    @State private var appState = AppState()

    var body: some View {
        NavigationSplitView {
            SidebarView()
        } content: {
            if appState.selectedSection == .settings {
                SettingsView()
            } else {
                ResultsListView()
            }
        } detail: {
            if appState.selectedSection == .settings {
                Text("Settings")
                    .foregroundStyle(.secondary)
            } else if let selected = appState.selectedResult {
                AppDetailView(result: selected)
            } else {
                EmptyStateView()
            }
        }
        .environment(appState)
        .frame(minWidth: 900, minHeight: 500)
        .task {
            if appState.settings.scanOnLaunch {
                await appState.scanAndSubmit()
            }
        }
    }
}
