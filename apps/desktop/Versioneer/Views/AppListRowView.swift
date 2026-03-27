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
    HStack(spacing: 12) {
      appIcon

      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 5) {
          Text(row.appName)
            .font(.body.weight(.medium))
            .lineLimit(1)
            .truncationMode(.tail)

          if let result, appState.isHomebrewInstalled(for: result) {
            Image(systemName: "mug.fill")
              .font(.caption2)
              .foregroundStyle(.secondary)
              .help("Installed via Homebrew")
          }
        }

        subtitleText
      }
      .layoutPriority(1)

      Spacer(minLength: 4)

      trailingContent
        .fixedSize()
    }
    .padding(.vertical, 5)
    .padding(.horizontal, 4)
    .contentShape(Rectangle())
    .animation(.spring(duration: 0.25), value: installState.phase)
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
    .frame(width: 28, height: 28)
  }

  @ViewBuilder
  private var subtitleText: some View {
    if installState.isRunning {
      HStack(spacing: 6) {
        ProgressView()
          .controlSize(.mini)
        Text(
          installState.detail.isEmpty
            ? installState.phase.rawValue.capitalized : installState.detail
        )
        .lineLimit(1)
      }
      .font(.caption)
      .foregroundStyle(Color.accentColor)
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
      StatusChip(
        title: installState.phase.rawValue.capitalized,
        tint: .accentColor,
        showsProgress: true
      )
      .transition(.opacity.combined(with: .scale))
    } else if installState.phase == .completed {
      StatusChip(
        title: "Updated",
        tint: .green,
        systemImage: "checkmark.circle.fill"
      )
      .transition(.scale.combined(with: .opacity))
    } else if installState.phase == .failed {
      StatusChip(
        title: "Failed",
        tint: .red,
        systemImage: "xmark.circle.fill"
      )
    } else if row.canInstall && row.isUpdateAvailable {
      Button {
        guard let result else { return }
        if appState.isHomebrewInstalled(for: result) {
          Task { await appState.brewUpgrade(result) }
        } else {
          Task { await appState.install(result) }
        }
      } label: {
        Text("Update")
          .font(.caption.weight(.semibold))
      }
      .buttonStyle(.glass)
      .controlSize(.small)
    } else {
      StatusChip(
        title: row.statusText,
        tint: row.statusTone.color,
        systemImage: row.statusSystemImage
      )
    }
  }
}
