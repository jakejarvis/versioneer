import SwiftUI

struct AppListRowView: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
            .font(.body.weight(.semibold))
            .lineLimit(1)
            .truncationMode(.tail)

          if let result, appState.isHomebrewInstalled(for: result) {
            Image(systemName: "mug.fill")
              .font(.caption2)
              .foregroundStyle(.secondary)
              .help("Installed via Homebrew")
              .accessibilityLabel("Installed via Homebrew")
          }
        }

        subtitleText
          .motionAwareAnimation(.spring(duration: 0.25), value: installState.phase)
      }
      .layoutPriority(1)

      Spacer(minLength: 4)

      trailingContent
        .fixedSize()
        .motionAwareAnimation(.spring(duration: 0.25), value: installState.phase)
    }
    .padding(.vertical, 8)
    .padding(.horizontal, 4)
    .background(
      isHovered && !isSelected ? Color.primary.opacity(0.04) : .clear,
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
    .frame(width: 36, height: 36)
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
        .font(.footnote.monospacedDigit())
        .foregroundStyle(Color.accentColor)
        .lineLimit(1)
    } else {
      Text(row.installedVersionText)
        .font(.footnote.monospacedDigit())
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
      .transition(.motionAware(.opacity.combined(with: .scale), reduceMotion: reduceMotion))
    } else if installState.phase == .completed {
      StatusChip(
        title: "Updated",
        tint: .green,
        systemImage: "checkmark.circle.fill"
      )
      .transition(.motionAware(.scale.combined(with: .opacity), reduceMotion: reduceMotion))
    } else if installState.phase == .failed {
      StatusChip(
        title: "Failed",
        tint: .red,
        systemImage: "xmark.circle.fill"
      )
    } else if row.canInstall && row.isUpdateAvailable {
      Button {
        guard let result else { return }
        if appState.isMasUpgradeable(for: result) {
          Task { await appState.masUpgrade(result) }
        } else if appState.isHomebrewInstalled(for: result) {
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
      .accessibilityLabel("Update \(row.appName)")
    } else {
      StatusChip(
        title: row.statusText,
        tint: row.statusTone.color,
        systemImage: row.statusSystemImage
      )
    }
  }

  @ViewBuilder
  private func rowContextMenu(for result: AppDecision) -> some View {
    let hasPath = appState.appPathText(for: result) != nil
    let hasBundleId = appState.bundleIdText(for: result) != nil

    Button("Open App") {
      appState.openApp(result)
    }
    .disabled(!hasPath)

    Button("Show in Finder") {
      appState.revealAppInFinder(result)
    }
    .disabled(!hasPath)

    Button("Open Details") {
      withMotionAwareAnimation(reduceMotion: reduceMotion) {
        appState.openDetail(id: result.id)
      }
    }

    Divider()

    if !isUserIgnored && row.isUpdateAvailable && row.canInstall {
      if appState.isMasUpgradeable(for: result) {
        Button("Update via Mac App Store") {
          Task { await appState.masUpgrade(result) }
        }
      } else if appState.isHomebrewInstalled(for: result) {
        Button("Update via Homebrew") {
          Task { await appState.brewUpgrade(result) }
        }
      } else {
        Button("Update") {
          Task { await appState.install(result) }
        }
      }

      Divider()
    }

    if isUserIgnored {
      Button("Unignore") {
        appState.unignore(result)
      }
    } else {
      Button("Ignore") {
        appState.ignore(result)
      }
    }

    Divider()

    Button("Copy Bundle ID") {
      appState.copyBundleId(result)
    }
    .disabled(!hasBundleId)

    Button("Copy Path") {
      appState.copyAppPath(result)
    }
    .disabled(!hasPath)
  }
}
