import SwiftUI

struct AppListRowView: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator

  let row: ResultsBrowserRowPresentation

  private var result: AppDecision? {
    appState.inventoryResults.first { $0.id == row.id }
  }

  private var installState: InstallCoordinator.OperationState {
    guard let result else { return .idle }
    return installCoordinator.state(for: result)
  }

  var body: some View {
    HStack(spacing: 14) {
      appIcon

      VStack(alignment: .leading, spacing: 3) {
        Text(row.appName)
          .font(.body.weight(.medium))
          .lineLimit(1)

        subtitleText
      }

      Spacer(minLength: 8)

      trailingContent
    }
    .padding(.vertical, 6)
    .padding(.horizontal, 4)
    .contentShape(Rectangle())
  }

  private var appIcon: some View {
    Group {
      if let result {
        Image(nsImage: appState.appIcon(for: result))
          .resizable()
      } else {
        Image(systemName: "app.fill")
          .resizable()
          .foregroundStyle(.secondary)
      }
    }
    .aspectRatio(contentMode: .fit)
    .frame(width: 32, height: 32)
  }

  @ViewBuilder
  private var subtitleText: some View {
    if installState.isRunning {
      Text(
        installState.detail.isEmpty ? installState.phase.rawValue.capitalized : installState.detail
      )
      .font(.caption)
      .foregroundStyle(Color.accentColor)
      .lineLimit(1)
      .transition(.opacity)
    } else if let versionDiff = row.versionDiffText {
      Text(versionDiff)
        .font(.caption.monospacedDigit())
        .foregroundStyle(.orange)
        .lineLimit(1)
    } else {
      Text(row.installedVersionText)
        .font(.caption.monospacedDigit())
        .foregroundStyle(.secondary)
        .lineLimit(1)
    }
  }

  @ViewBuilder
  private var trailingContent: some View {
    if installState.isRunning {
      inlineProgress
        .transition(.opacity.combined(with: .scale))
    } else if installState.phase == .completed {
      VersioneerStatusChip(
        title: "Updated",
        tint: .green,
        systemImage: "checkmark.circle.fill"
      )
      .transition(.scale.combined(with: .opacity))
    } else if installState.phase == .failed {
      VersioneerStatusChip(
        title: "Failed",
        tint: .red,
        systemImage: "xmark.circle.fill"
      )
    } else if row.canInstall && row.isUpdateAvailable {
      Button {
        guard let result else { return }
        Task { await appState.install(result) }
      } label: {
        Text("Update")
          .font(.caption.weight(.semibold))
      }
      .buttonStyle(.borderedProminent)
      .controlSize(.small)
    } else {
      VersioneerStatusChip(
        title: row.statusText,
        tint: row.statusTone.color,
        systemImage: row.statusSystemImage
      )
    }
  }

  private var inlineProgress: some View {
    HStack(spacing: 8) {
      ProgressView()
        .controlSize(.small)

      Text(installState.phase.rawValue.capitalized)
        .font(.caption.weight(.semibold))
        .foregroundStyle(Color.accentColor)
        .lineLimit(1)
    }
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
  }
}
