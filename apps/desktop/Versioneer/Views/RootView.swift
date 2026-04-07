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
      sidebarContent
        .navigationSplitViewColumnWidth(min: 250, ideal: 290, max: 360)
    } detail: {
      detailContent
        .motionAwareAnimation(.easeInOut(duration: 0.2), value: appState.selectedAppID)
    }
    .navigationSplitViewStyle(.balanced)
    .toolbar {
      ToolbarItemGroup(placement: .primaryAction) {
        Picker(
          "Sort",
          selection: Binding(
            get: { appState.resultsSort },
            set: { appState.setResultsSort($0) }
          )
        ) {
          ForEach(ResultsBrowserSort.allCases) { sort in
            Text(sort.title).tag(sort)
          }
        }
        .pickerStyle(.menu)
        .help("Sort order")

        Button {
          Task { await appState.scanAndSubmit() }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .disabled(appState.loadState == .scanning || appState.loadState == .submitting)
        .help("Refresh (⌘R)")
        .accessibilityLabel("Refresh")
      }
    }
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
    .onDisappear {
      searchDebounceTask?.cancel()
    }
  }

  private var sidebarContent: some View {
    VStack(spacing: 0) {
      FilterChipBar()
      listContent
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(resultsPaneBackground)
      StatusBarView()
    }
  }

  @ViewBuilder
  private var detailContent: some View {
    if let selectedResult = appState.selectedResult {
      DetailPaneView(result: selectedResult)
        .id(selectedResult.id)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(detailPaneBackground)
    } else {
      ContentUnavailableView {
        Label("Select an App", systemImage: "sidebar.right")
      } description: {
        Text("Choose an app from the list to view its status, versions, and update actions.")
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
      .background(detailPaneBackground)
    }
  }

  // MARK: - List Content

  @ViewBuilder
  private var listContent: some View {
    let rows = appState.resultsBrowserRows

    if appState.loadState == .idle && rows.isEmpty && !appState.hasCachedResults {
      ScannerAnimationView()
    } else if case .scanning = appState.loadState, !appState.hasCachedResults {
      ScannerAnimationView()
    } else if case .submitting = appState.loadState, !appState.hasCachedResults {
      ScannerAnimationView()
    } else if case .error(let message) = appState.loadState, !appState.hasCachedResults {
      ErrorStateView(
        message: message,
        retryAction: { Task { await appState.scanAndSubmit() } }
      )
    } else if rows.isEmpty && !appState.searchText.isEmpty {
      ContentUnavailableView {
        Label("No Search Results", systemImage: "magnifyingglass")
      } description: {
        Text(
          "No apps match \"\(appState.searchText)\". Try a different search term or clear the search field."
        )
      }
    } else if rows.isEmpty {
      ContentUnavailableView {
        Label("No Results", systemImage: "app.dashed")
      } description: {
        Text("No apps match the current filter. Try a different section or search term.")
      }
    } else {
      appList(rows: rows)
    }
  }

  private func appList(rows: [ResultsBrowserRowPresentation]) -> some View {
    @Bindable var appState = appState

    return List(selection: $appState.selectedAppID) {
      ForEach(rows) { row in
        AppListRowView(row: row)
          .tag(row.id)
      }
    }
    .listStyle(.inset)
    .scrollContentBackground(.hidden)
    .onDeleteCommand {
      guard let result = appState.selectedResult,
        !appState.isUserIgnored(result)
      else { return }
      appState.ignore(result, undoManager: undoManager)
    }
  }

  private var resultsPaneBackground: some View {
    Color(nsColor: .windowBackgroundColor)
      .overlay {
        Color.primary.opacity(0.03)
      }
  }

  private var detailPaneBackground: some View {
    Color(nsColor: .windowBackgroundColor)
      .overlay {
        Color.primary.opacity(0.02)
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
