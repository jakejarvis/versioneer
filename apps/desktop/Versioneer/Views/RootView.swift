import SwiftUI

struct RootView: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator

  var body: some View {
    @Bindable var appState = appState

    NavigationSplitView {
      sidebar
    } detail: {
      ZStack(alignment: .trailing) {
        listContent
          .safeAreaInset(edge: .bottom) {
            FloatingActionBarView()
          }

        if let detailResult = appState.detailResult {
          DetailPanelView(result: detailResult)
            .id(detailResult.id)
            .frame(width: 420)
            .frame(maxHeight: .infinity)
            .transition(.move(edge: .trailing).combined(with: .opacity))
        }
      }
      .animation(.snappy(duration: 0.3), value: appState.detailResult?.id)
      .searchable(text: $appState.searchText, prompt: "Filter apps")
      .toolbar {
        ToolbarItemGroup(placement: .primaryAction) {
          sortPicker
          scanButton
        }
      }
    }
    .navigationSplitViewColumnWidth(min: 180, ideal: 200, max: 240)
    .frame(minWidth: 900, minHeight: 560)
    .versioneerAnalyticsScreen(name: "main_window", class: "RootView")
    .task {
      await Task.yield()
      await appState.scanAndSubmit()
    }
  }

  // MARK: - Sidebar

  private var sidebar: some View {
    @Bindable var appState = appState
    return List(selection: $appState.selectedSection) {
      ForEach(AppState.SidebarSection.allCases) { section in
        Label(section.rawValue, systemImage: section.systemImage)
          .badge(sidebarCount(for: section))
          .tag(section)
      }
    }
    .navigationTitle("Versioneer")
  }

  private func sidebarCount(for section: AppState.SidebarSection) -> Int {
    let summary = appState.scanSummary
    return switch section {
    case .all: summary.totalApps
    case .updatesAvailable: summary.updatesAvailableCount
    case .unknown: summary.unknownCount
    case .unsupported: summary.unsupportedCount
    }
  }

  // MARK: - Toolbar Items

  private var sortPicker: some View {
    @Bindable var appState = appState
    return Picker("Sort", selection: $appState.resultsSort) {
      ForEach(ResultsBrowserSort.allCases) { sort in
        Text(sort.title).tag(sort)
      }
    }
    .pickerStyle(.menu)
    .fixedSize()
  }

  private var scanButton: some View {
    Button {
      Task { await appState.scanAndSubmit() }
    } label: {
      HStack(spacing: 8) {
        if appState.loadState == .scanning || appState.loadState == .submitting {
          ProgressView()
            .controlSize(.small)
        }
        Text(scanButtonLabel)
      }
    }
    .buttonStyle(.borderedProminent)
    .disabled(appState.loadState == .scanning || appState.loadState == .submitting)
  }

  private var scanButtonLabel: String {
    switch appState.loadState {
    case .scanning: "Scanning…"
    case .submitting: "Checking…"
    default: "Scan & Check"
    }
  }

  // MARK: - List Content

  @ViewBuilder
  private var listContent: some View {
    @Bindable var appState = appState
    let rows = appState.resultsBrowserRows

    if appState.loadState == .idle && rows.isEmpty && !appState.hasCachedResults {
      ContentUnavailableView {
        ProgressView()
          .controlSize(.large)
      } description: {
        Text("Discovering your apps…")
      }
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
      List(selection: $appState.selectedResultIDs) {
        ForEach(rows) { row in
          AppListRowView(row: row)
            .tag(row.id)
        }
      }
      .listStyle(.inset)
      .onChange(of: appState.selectedResultIDs) { oldValue, newValue in
        guard !newValue.isEmpty else {
          withAnimation(.snappy(duration: 0.3)) {
            appState.detailResult = nil
          }
          return
        }
        let added = newValue.subtracting(oldValue)
        if let id = added.first ?? newValue.first {
          withAnimation(.snappy(duration: 0.3)) {
            appState.openDetail(id: id)
          }
        }
      }
    }
  }
}
