import AppKit
import SwiftUI

struct RootView: View {
  @Environment(AppState.self) private var appState

  @Environment(\.undoManager) private var undoManager

  @State private var searchInput: String = ""
  @State private var searchDebounceTask: Task<Void, Never>?
  @State private var columnVisibility: NavigationSplitViewVisibility = .all

  var body: some View {
    NavigationSplitView(columnVisibility: $columnVisibility) {
      SidebarView()
        .navigationSplitViewColumnWidth(min: 250, ideal: 290, max: 360)
    } detail: {
      DetailSelectionView()
        .motionAwareAnimation(.easeInOut(duration: 0.2), value: appState.selectedAppID)
    }
    .navigationSplitViewStyle(.balanced)
    .toolbar(removing: .sidebarToggle)
    .searchable(text: $searchInput, placement: .sidebar, prompt: "Filter apps")
    .onChange(of: searchInput) { _, newValue in
      searchDebounceTask?.cancel()
      searchDebounceTask = Task {
        try? await Task.sleep(for: .milliseconds(200))
        guard !Task.isCancelled else { return }
        appState.setSearchText(newValue)
      }
    }
    .onExitCommand {
      guard appState.selectedAppID != nil else { return }
      appState.selectedAppID = nil
    }
    .frame(minWidth: 680, minHeight: 500)
    .background(TranslucentWindowBackground())
    .versioneerAnalyticsScreen(name: "main_window", class: "RootView")
    .task {
      appState.windowUndoManager = undoManager
      guard !isRunningPreview else { return }
      await appState.loadPreflight()
      guard appState.settings.scanOnLaunch else { return }
      await Task.yield()
      await appState.scanAndSubmit()
    }
    .task(id: appState.visibleUpdateCount) {
      updateDockBadge(with: appState.visibleUpdateCount)
    }
    .alert(
      appState.pendingInstallConfirmationTitle(),
      isPresented: Binding(
        get: { appState.pendingInstallConfirmation != .none },
        set: { if !$0 { appState.cancelPendingInstallRequest() } }
      )
    ) {
      Button("Continue") {
        appState.confirmPendingInstallRequest()
      }
      Button("Cancel", role: .cancel) {
        appState.cancelPendingInstallRequest()
      }
    } message: {
      Text(appState.pendingInstallConfirmationMessage())
    }
    .onDisappear {
      searchDebounceTask?.cancel()
    }
  }

  private func updateDockBadge(with count: Int) {
    NSApp.dockTile.badgeLabel = count > 0 ? "\(count)" : nil
    NSApp.dockTile.display()
  }

  private var isRunningPreview: Bool {
    ProcessInfo.processInfo.environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
  }
}
