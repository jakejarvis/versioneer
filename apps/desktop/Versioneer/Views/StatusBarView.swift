import SwiftUI

struct StatusBarView: View {
  @Environment(AppState.self) private var appState

  private var isLoading: Bool {
    appState.loadState == .scanning || appState.loadState == .submitting
  }

  var body: some View {
    let presentation = appState.statusBarPresentation

    HStack(spacing: 8) {
      Text(presentation.isScanning ? "Checking…" : presentation.lastCheckedText)

      Spacer()

      Text(presentation.appCountText)

      Button {
        Task { await appState.scanAndSubmit() }
      } label: {
        Group {
          if isLoading {
            ProgressView()
              .controlSize(.mini)
          } else {
            Image(systemName: "arrow.clockwise")
          }
        }
        .frame(width: 14, height: 14)
      }
      .buttonStyle(.plain)
      .focusEffectDisabled()
      .foregroundStyle(.secondary)
      .disabled(isLoading)
      .help("Refresh (⌘R)")
      .keyboardShortcut("r", modifiers: .command)
    }
    .font(.caption)
    .foregroundStyle(.secondary)
    .padding(.horizontal, 14)
    .padding(.vertical, 8)
    .background(.ultraThinMaterial)
    .overlay(alignment: .top) {
      Divider()
    }
    .animation(.easeInOut(duration: 0.2), value: presentation.isScanning)
  }
}
