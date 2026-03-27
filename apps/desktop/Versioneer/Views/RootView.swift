import SwiftUI

struct RootView: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator

  var body: some View {
    @Bindable var appState = appState

    ZStack(alignment: .trailing) {
      // Main content: header + list
      VStack(spacing: 0) {
        AppListHeaderView()

        listContent
          .safeAreaInset(edge: .bottom) {
            FloatingActionBarView()
          }
      }

      // Detail panel overlay
      if let detailResult = appState.detailResult {
        Color.black.opacity(0.001)
          .ignoresSafeArea()
          .onTapGesture {
            withAnimation(.snappy(duration: 0.3)) {
              appState.closeDetail()
            }
          }

        DetailPanelView(result: detailResult)
          .frame(width: 420)
          .frame(maxHeight: .infinity)
          .transition(.move(edge: .trailing).combined(with: .opacity))
      }
    }
    .animation(.snappy(duration: 0.3), value: appState.detailResult?.id)
    .frame(minWidth: 900, minHeight: 560)
    .searchable(text: $appState.searchText, prompt: "Filter apps")
    .versioneerAnalyticsScreen(name: "main_window", class: "RootView")
    .task {
      await Task.yield()
      await appState.scanAndSubmit()
    }
  }

  @ViewBuilder
  private var listContent: some View {
    let rows = appState.resultsBrowserRows

    if appState.loadState == .idle && rows.isEmpty && !appState.hasCachedResults {
      // Scanning in progress — first launch
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
      List(selection: binding(for: \.selectedResultIDs)) {
        ForEach(rows) { row in
          AppListRowView(row: row)
            .tag(row.id)
            .onTapGesture {
              withAnimation(.snappy(duration: 0.3)) {
                appState.openDetail(id: row.id)
              }
            }
        }
      }
      .listStyle(.inset)
    }
  }

  private func binding<Value>(for keyPath: ReferenceWritableKeyPath<AppState, Value>) -> Binding<
    Value
  > {
    Binding(
      get: { appState[keyPath: keyPath] },
      set: { appState[keyPath: keyPath] = $0 }
    )
  }
}
