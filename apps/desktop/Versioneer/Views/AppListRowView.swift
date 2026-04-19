import AppKit
import SwiftUI

struct AppListRowView: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator
  @Environment(\.accessibilityReduceMotion) private var reduceMotion
  @Environment(\.undoManager) private var undoManager

  let row: ResultsBrowserRowPresentation

  @State private var isHovered = false

  private var result: AppDecision? {
    appState.inventoryResultsByID[row.id]
  }

  private var installState: InstallCoordinator.OperationState {
    guard let result else { return .idle }
    return installCoordinator.state(for: result)
  }

  private var isUserIgnored: Bool {
    guard let result else { return false }
    return appState.isUserIgnored(result)
  }

  private var isSelected: Bool {
    appState.selectedAppID == row.id
  }

  var body: some View {
    HStack(spacing: 12) {
      appIcon

      VStack(alignment: .leading, spacing: 2) {
        HStack(spacing: 5) {
          Text(row.appName)
            .font(.body.weight(.medium))
            .foregroundStyle(primaryTextStyle)
            .lineLimit(1)
            .truncationMode(.tail)

          if let result, appState.isHomebrewInstalled(for: result) {
            Image(systemName: "mug.fill")
              .font(.caption2)
              .foregroundStyle(secondaryTextStyle)
              .help("Installed via Homebrew")
              .accessibilityLabel("Installed via Homebrew")
          }
        }

        AppListRowSubtitle(row: row, installState: installState, isSelected: isSelected)
          .motionAwareAnimation(.spring(duration: 0.25), value: installState.phase)
      }
      .layoutPriority(1)

      Spacer(minLength: 4)

      AppListRowTrailingContent(
        row: row,
        result: result,
        installState: installState,
        isSelected: isSelected,
        isRowHovered: isHovered
      )
        .fixedSize()
        .motionAwareAnimation(.spring(duration: 0.25), value: installState.phase)
    }
    .padding(.vertical, 7)
    .padding(.horizontal, 6)
    .background(
      isHovered && !isSelected ? Color.primary.opacity(0.045) : .clear,
      in: .rect(cornerRadius: 8)
    )
    .contentShape(Rectangle())
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(row.appName), \(row.statusText)")
    .onHover { isHovered = $0 }
    .contextMenu {
      if let result {
        rowContextMenu(for: result)
      }
    }
  }

  private var primaryTextStyle: Color {
    isSelected ? Color(nsColor: .selectedControlTextColor) : Color.primary
  }

  private var secondaryTextStyle: Color {
    isSelected ? Color(nsColor: .selectedControlTextColor).opacity(0.76) : Color.secondary
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

  // MARK: - Context Menu

  @ViewBuilder
  private func rowContextMenu(for result: AppDecision) -> some View {
    AppContextMenuItems(result: result)

    Button("Open Details") {
      withMotionAwareAnimation(reduceMotion: reduceMotion) {
        appState.openDetail(id: result.id)
      }
    }

    Divider()

    if !isUserIgnored && row.isUpdateAvailable && row.hasUpdateAction {
      contextMenuUpdateAction(for: result)
      Divider()
    }

    if isUserIgnored {
      Button("Unignore") {
        appState.unignore(result, undoManager: undoManager)
      }
    } else {
      Button("Ignore") {
        appState.ignore(result, undoManager: undoManager)
      }
    }
  }

  @ViewBuilder
  private func contextMenuUpdateAction(for result: AppDecision) -> some View {
    if appState.isMasUpgradeable(for: result) {
      Button("Update via Mac App Store") {
        Task { await appState.masUpgrade(result) }
      }
    } else if appState.isHomebrewInstalled(for: result) {
      Button("Update via Homebrew") {
        Task { await appState.brewUpgrade(result) }
      }
    } else if result.canInstall {
      Button("Update") {
        Task { await appState.install(result) }
      }
    } else {
      Button(appState.primaryActionTitle(for: result)) {
        appState.openManualUpdate(result)
      }
    }
  }
}

// MARK: - Subtitle

private struct AppListRowSubtitle: View {
  let row: ResultsBrowserRowPresentation
  let installState: InstallCoordinator.OperationState
  let isSelected: Bool

  @ViewBuilder
  var body: some View {
    if installState.isRunning {
      HStack(spacing: 6) {
        ProgressView()
          .controlSize(.mini)
          .tint(runningStyle)
        Text(
          installState.detail.isEmpty
            ? installState.phase.rawValue.capitalized : installState.detail
        )
        .lineLimit(1)
      }
      .font(.caption)
      .foregroundStyle(runningStyle)
      .transition(.opacity)
    } else if let versionDiff = row.versionDiffText {
      Text(versionDiff)
        .font(.footnote.monospacedDigit())
        .foregroundStyle(versionDiffStyle)
        .lineLimit(1)
    } else {
      Text(row.installedVersionText)
        .font(.footnote.monospacedDigit())
        .foregroundStyle(secondaryStyle)
        .lineLimit(1)
    }
  }

  private var runningStyle: Color {
    isSelected ? Color(nsColor: .selectedControlTextColor) : Color.accentColor
  }

  private var versionDiffStyle: Color {
    isSelected ? Color(nsColor: .selectedControlTextColor).opacity(0.82) : Color.accentColor
  }

  private var secondaryStyle: Color {
    isSelected ? Color(nsColor: .selectedControlTextColor).opacity(0.72) : Color.secondary
  }
}

// MARK: - Trailing Content

private struct AppListRowTrailingContent: View {
  @Environment(AppState.self) private var appState
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  let row: ResultsBrowserRowPresentation
  let result: AppDecision?
  let installState: InstallCoordinator.OperationState
  let isSelected: Bool
  let isRowHovered: Bool

  private var showsInlineAction: Bool {
    isSelected || isRowHovered
  }

  @ViewBuilder
  var body: some View {
    if installState.isRunning {
      StatusChip(
        title: installState.phase.rawValue.capitalized,
        tint: statusTint(.accentColor),
        showsProgress: true
      )
      .transition(.motionAware(.opacity.combined(with: .scale), reduceMotion: reduceMotion))
    } else if installState.phase == .completed {
      StatusChip(
        title: "Updated",
        tint: statusTint(.green),
        systemImage: "checkmark.circle.fill"
      )
      .transition(.motionAware(.scale.combined(with: .opacity), reduceMotion: reduceMotion))
    } else if installState.phase == .failed {
      StatusChip(
        title: "Failed",
        tint: statusTint(.red),
        systemImage: "xmark.circle.fill"
      )
    } else if row.hasUpdateAction && row.isUpdateAvailable, let result {
      if showsInlineAction {
        Button {
          Task { await appState.performPrimaryUpdate(for: result) }
        } label: {
          Text(appState.primaryActionCompactTitle(for: result))
            .font(.caption.weight(.semibold))
        }
        .buttonStyle(SidebarRowActionButtonStyle(isSelected: isSelected))
        .accessibilityLabel("\(appState.primaryActionTitle(for: result)) \(row.appName)")
        .transition(.motionAware(.opacity.combined(with: .scale(scale: 0.96)), reduceMotion: reduceMotion))
      }
    } else {
      StatusChip(
        title: row.statusText,
        tint: statusTint(row.statusTone.color),
        systemImage: row.statusSystemImage
      )
    }
  }

  private func statusTint(_ tint: Color) -> Color {
    isSelected ? Color(nsColor: .selectedControlTextColor) : tint
  }
}

private struct SidebarRowActionButtonStyle: ButtonStyle {
  let isSelected: Bool

  func makeBody(configuration: Configuration) -> some View {
    configuration.label
      .lineLimit(1)
      .foregroundStyle(foregroundStyle)
      .padding(.horizontal, 9)
      .padding(.vertical, 4)
      .background(backgroundColor(isPressed: configuration.isPressed), in: .capsule)
      .overlay {
        Capsule(style: .continuous)
          .strokeBorder(borderColor, lineWidth: 0.5)
      }
      .contentShape(Capsule(style: .continuous))
  }

  private var foregroundStyle: Color {
    isSelected ? Color(nsColor: .selectedControlTextColor) : Color.primary
  }

  private func backgroundColor(isPressed: Bool) -> Color {
    if isSelected {
      return Color(nsColor: .selectedControlTextColor).opacity(isPressed ? 0.28 : 0.18)
    }
    return Color.primary.opacity(isPressed ? 0.12 : 0.075)
  }

  private var borderColor: Color {
    isSelected
      ? Color(nsColor: .selectedControlTextColor).opacity(0.24)
      : Color.primary.opacity(0.08)
  }
}
