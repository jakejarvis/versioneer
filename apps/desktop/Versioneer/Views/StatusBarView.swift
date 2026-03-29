import SwiftUI

struct StatusBarView: View {
  @Environment(AppState.self) private var appState

  var body: some View {
    let presentation = appState.statusBarPresentation

    HStack(spacing: 8) {
      Text(presentation.isScanning ? "Checking…" : presentation.lastCheckedText)

      Spacer()

      Text(presentation.appCountText)
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
}
