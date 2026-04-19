import SwiftUI

struct StatusBarView: View {
  @Environment(AppState.self) private var appState

  var body: some View {
    let presentation = appState.statusBarPresentation

    HStack(spacing: 8) {
      if presentation.isScanning {
        ProgressView()
          .controlSize(.mini)
        Text("Checking apps…")
      } else {
        Text(presentation.lastCheckedText)
      }

      refreshButton(isScanning: presentation.isScanning)

      Spacer()

      Text(presentation.appCountText)

      Text("·")
        .foregroundStyle(.tertiary)

      sortMenu
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .padding(.horizontal, 14)
    .padding(.vertical, 6)
    .adaptiveMaterial()
    .overlay(alignment: .top) {
      Divider()
    }
    .motionAwareAnimation(.easeInOut(duration: 0.2), value: presentation.isScanning)
  }

  private func refreshButton(isScanning: Bool) -> some View {
    Button {
      Task { await appState.scanAndSubmit() }
    } label: {
      Image(systemName: "arrow.clockwise")
        .font(.caption.weight(.semibold))
        .frame(width: 14, height: 14)
    }
    .buttonStyle(.plain)
    .disabled(isScanning)
    .help("Refresh (⌘R)")
    .accessibilityLabel("Refresh")
  }

  private var sortMenu: some View {
    Menu {
      ForEach(ResultsBrowserSort.allCases) { sort in
        Button {
          appState.setResultsSort(sort)
        } label: {
          if appState.resultsSort == sort {
            Label(sort.title, systemImage: "checkmark")
          } else {
            Text(sort.title)
          }
        }
      }
    } label: {
      HStack(spacing: 3) {
        Text(appState.resultsSort.title)
          .lineLimit(1)
        Image(systemName: "chevron.up.chevron.down")
          .font(.caption2.weight(.semibold))
      }
    }
    .menuStyle(.button)
    .buttonStyle(.plain)
    .fixedSize()
    .help("Sort: \(appState.resultsSort.title)")
    .accessibilityLabel("Sort")
    .accessibilityValue(appState.resultsSort.title)
  }
}
