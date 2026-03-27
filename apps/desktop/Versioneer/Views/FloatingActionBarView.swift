import SwiftUI

struct FloatingActionBarView: View {
  @Environment(AppState.self) private var appState

  private var presentation: FloatingBarPresentation {
    appState.floatingBarPresentation
  }

  var body: some View {
    if presentation.isVisible {
      barContent
        .padding(.horizontal, 20)
        .padding(.vertical, 10)
        .frame(maxWidth: 600)
        .glassEffect(.regular, in: .rect(cornerRadius: 22))
        .frame(maxWidth: .infinity)
        .padding(.bottom, 12)
        .transition(.move(edge: .bottom).combined(with: .opacity))
        .animation(.snappy(duration: 0.3), value: presentation.mode)
    }
  }

  @ViewBuilder
  private var barContent: some View {
    switch presentation.mode {
    case .scanning(let detail):
      HStack(spacing: 12) {
        ProgressView()
          .controlSize(.small)
        Text("Scanning…")
          .font(.subheadline.weight(.semibold))
        Text(detail)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .lineLimit(1)
        Spacer()
      }

    case .submitting(let detail):
      HStack(spacing: 12) {
        ProgressView()
          .controlSize(.small)
        Text("Checking for updates…")
          .font(.subheadline.weight(.semibold))
        Text(detail)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .lineLimit(1)
        Spacer()
      }

    case .selection(let count, let updatableCount):
      HStack(spacing: 12) {
        Text("\(count) selected")
          .font(.subheadline.weight(.medium))
          .contentTransition(.numericText())
        Spacer()
        if updatableCount > 0 {
          Button {
            Task { await appState.installAll(ids: appState.selectedResultIDs) }
          } label: {
            Text("Update Selected (\(updatableCount))")
              .font(.subheadline.weight(.semibold))
          }
          .buttonStyle(.borderedProminent)
          .controlSize(.small)
        }
        Button {
          appState.selectedResultIDs.removeAll()
        } label: {
          Text("Deselect")
            .font(.subheadline)
        }
        .buttonStyle(.bordered)
        .controlSize(.small)
      }

    case .installing(let appName, let phase):
      HStack(spacing: 12) {
        ProgressView()
          .controlSize(.small)
        Text("\(phase) \(appName)")
          .font(.subheadline.weight(.semibold))
          .lineLimit(1)
        Spacer()
      }

    case .error(let message):
      HStack(spacing: 12) {
        Image(systemName: "exclamationmark.triangle.fill")
          .foregroundStyle(.red)
        Text(message)
          .font(.subheadline)
          .foregroundStyle(.secondary)
          .lineLimit(1)
        Spacer()
        Button("Retry") {
          Task { await appState.scanAndSubmit() }
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
      }

    case .idle:
      EmptyView()
    }
  }
}
