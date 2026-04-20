import SwiftUI

struct SidebarView: View {
  @Environment(AppState.self) private var appState
  @Environment(\.undoManager) private var undoManager

  var body: some View {
    VStack(spacing: 0) {
      FilterChipBar()
      listContent
        .frame(maxWidth: .infinity, maxHeight: .infinity)
      StatusBarView()
    }
  }

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
    .listStyle(.sidebar)
    .onDeleteCommand {
      guard let result = appState.selectedResult,
        !appState.isUserIgnored(result)
      else { return }
      appState.ignore(result, undoManager: undoManager)
    }
  }
}
