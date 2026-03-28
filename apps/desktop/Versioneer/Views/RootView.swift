import SwiftUI

struct RootView: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  @State private var searchInput: String = ""
  @State private var searchDebounceTask: Task<Void, Never>?

  var body: some View {
    ZStack {
      // Main content
      VStack(spacing: 0) {
        FilterChipBar()
        listContent
          .frame(maxWidth: .infinity, maxHeight: .infinity)
          .background(resultsPaneBackground)
        StatusBarView()
      }

      // Full-window overlay
      if appState.detailResult != nil {
        DetailOverlayView()
          .motionAwareAnimation(.spring(duration: 0.3), value: appState.detailResult?.id)
      }
    }
    .toolbar {
      ToolbarItemGroup(placement: .primaryAction) {
        Button {
          Task { await appState.scanAndSubmit() }
        } label: {
          Label("Refresh", systemImage: "arrow.clockwise")
        }
        .disabled(appState.loadState == .scanning || appState.loadState == .submitting)
        .help("Refresh (⌘R)")
        .accessibilityLabel("Refresh")

        if !appState.updatableResults.isEmpty {
          Button {
            Task { await appState.installAll() }
          } label: {
            Label("Update All", systemImage: "arrow.down.circle")
          }
          .help("Update All (⌘⇧U)")
          .accessibilityLabel("Update all \(appState.updatableResults.count) apps")
        }
      }
    }
    .searchable(text: $searchInput, placement: .toolbar, prompt: "Filter apps")
    .onChange(of: searchInput) { _, newValue in
      searchDebounceTask?.cancel()
      searchDebounceTask = Task {
        try? await Task.sleep(for: .milliseconds(200))
        guard !Task.isCancelled else { return }
        appState.setSearchText(newValue)
      }
    }
    .toolbarRole(.editor)
    .frame(minWidth: 500, minHeight: 400)
    .background(TranslucentWindowBackground())
    .versioneerAnalyticsScreen(name: "main_window", class: "RootView")
    .onKeyPress(.escape) {
      if appState.detailResult != nil {
        withMotionAwareAnimation(reduceMotion: reduceMotion) {
          appState.closeDetail()
        }
        return .handled
      }
      return .ignored
    }
    .task {
      await Task.yield()
      await appState.scanAndSubmit()
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
      ContentUnavailableView.search(text: appState.searchText)
    } else if rows.isEmpty {
      ContentUnavailableView {
        Label("No Results", systemImage: "app.dashed")
      } description: {
        Text("No apps match the current filter.")
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
    .onChange(of: appState.selectedAppID) { _, newValue in
      guard let newValue else {
        withMotionAwareAnimation(reduceMotion: reduceMotion) {
          appState.detailResult = nil
        }
        return
      }
      withMotionAwareAnimation(reduceMotion: reduceMotion) {
        appState.openDetail(id: newValue)
      }
    }
    .onKeyPress(.return) {
      if let selectedID = appState.selectedAppID, appState.detailResult == nil {
        withMotionAwareAnimation(reduceMotion: reduceMotion) {
          appState.openDetail(id: selectedID)
        }
        return .handled
      }
      return .ignored
    }
  }

  private var resultsPaneBackground: some View {
    Color(nsColor: .windowBackgroundColor)
      .overlay {
        Color.primary.opacity(0.03)
      }
  }
}
