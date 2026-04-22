import SwiftUI

struct DetailSummaryPanel: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator
  @Environment(\.undoManager) private var undoManager

  let result: AppDecision

  @Binding var showFeedbackSheet: Bool
  @Binding var showInstallWarning: Bool
  @Binding var showBrewBypassWarning: Bool

  private var installState: InstallCoordinator.OperationState {
    installCoordinator.state(for: result)
  }

  private var installPresentation: InstallPresentation {
    InstallPresentation.make(result: result, state: installState)
  }

  private var actionPresentation: PrimaryAppActionPresentation {
    appState.primaryActionPresentation(for: result, installState: installState)
  }

  private var installedApp: InstalledApp? {
    appState.installedApp(for: result)
  }

  private var isUserIgnored: Bool {
    appState.isUserIgnored(result)
  }

  private var isBrewApp: Bool {
    appState.isHomebrewInstalled(for: result)
  }

  private var isMasUpgradeable: Bool {
    appState.isMasUpgradeable(for: result)
  }

  private var hasAppPath: Bool {
    appState.appPathText(for: result) != nil
  }

  private var manualUpdateAction: ManualUpdateAction? {
    appState.manualUpdateAction(for: result)
  }

  private var installTrustDetail: String? {
    guard result.decision == .updateAvailable,
      result.installTrust.status == .manualOnly,
      !result.installTrust.reasons.isEmpty
    else { return nil }

    let labels = result.installTrust.reasons.map { reason in
      switch reason {
      case .missingArtifact: "download artifact"
      case .missingSHA256: "SHA-256 checksum"
      case .missingBundleID: "bundle identifier"
      case .missingTeamID: "Developer Team ID"
      case .missingSparklePublicKey: "Sparkle public key"
      case .macAppStoreExternal: "Mac App Store route"
      case .homebrewExternal: "Homebrew route"
      case .manualOnly: "manual install policy"
      case .unsupportedStrategy: "supported install strategy"
      }
    }
    return "One-click install is disabled until Versioneer has: \(labels.joined(separator: ", "))."
  }

  private var decisionTitle: String {
    if result.isLocalOnly {
      return result.localOnlyStatusTitle
    }
    switch result.decision {
    case .updateAvailable: return "Update Available"
    case .upToDate: return "Up to Date"
    case .ambiguous: return "Needs Review"
    case .localOnly: return "Local Only"
    }
  }

  private var decisionTint: Color {
    if result.isLocalOnly {
      return result.decision == .updateAvailable ? .orange : .secondary
    }
    switch result.decision {
    case .updateAvailable: return .accentColor
    case .upToDate: return .green
    case .ambiguous: return .orange
    case .localOnly: return .secondary
    }
  }

  private var decisionSymbol: String {
    if result.isLocalOnly {
      return result.decision == .updateAvailable ? "arrow.up.circle" : "desktopcomputer"
    }
    switch result.decision {
    case .updateAvailable: return "arrow.up.circle.fill"
    case .upToDate: return "checkmark.circle.fill"
    case .ambiguous: return "scope"
    case .localOnly: return "desktopcomputer"
    }
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 16) {
      ViewThatFits(in: .horizontal) {
        HStack(alignment: .top, spacing: 18) {
          identityBlock
          Spacer(minLength: 16)
          actionCluster
        }

        VStack(alignment: .leading, spacing: 16) {
          identityBlock
          actionCluster
        }
      }

      if installState.isRunning, let progress = installPresentation.progress {
        DetailInlineProgressView(progress: progress, detail: installPresentation.statusDetail)
      }

      if !callouts.isEmpty {
        DetailCalloutGroup(callouts: callouts)
      }

      if let recoveryAction = installPresentation.recoveryAction {
        Button(installCoordinator.recoveryActionTitle(recoveryAction)) {
          installCoordinator.performRecoveryAction(recoveryAction)
        }
        .buttonStyle(.link)
      }
    }
    .glassCard(interactive: true, cornerRadius: 18, padding: 18)
    .contextMenu {
      AppContextMenuItems(result: result)
    }
  }

  private var identityBlock: some View {
    HStack(alignment: .top, spacing: 16) {
      Image(nsImage: appState.appIcon(for: result))
        .resizable()
        .aspectRatio(contentMode: .fit)
        .frame(width: 60, height: 60)

      VStack(alignment: .leading, spacing: 8) {
        VStack(alignment: .leading, spacing: 5) {
          Text(result.matchedAppName ?? result.appName)
            .font(.title2.weight(.semibold))
            .lineLimit(2)

          versionLine
        }

        statusRow
      }
      .layoutPriority(1)
    }
  }

  @ViewBuilder
  private var versionLine: some View {
    if result.decision == .updateAvailable,
      let installed = result.installedVersion,
      let latest = result.latestVersion
    {
      VersionDiffLabel(
        installed: VersionFormatting.displayVersion(installed),
        latest: VersionFormatting.displayVersion(latest)
      )
    } else {
      Text(VersionFormatting.displayVersion(result.installedVersion))
        .font(.callout.monospacedDigit())
        .foregroundStyle(.secondary)
    }
  }

  private var statusRow: some View {
    ViewThatFits(in: .horizontal) {
      HStack(spacing: 8) {
        primaryStatusChips
        secondaryStatusChips
      }

      VStack(alignment: .leading, spacing: 6) {
        HStack(spacing: 8) {
          primaryStatusChips
        }

        if hasSecondaryStatusChips {
          HStack(spacing: 8) {
            secondaryStatusChips
          }
        }
      }
    }
  }

  @ViewBuilder
  private var primaryStatusChips: some View {
    StatusChip(
      title: decisionTitle,
      tint: decisionTint,
      systemImage: decisionSymbol
    )

    if let sourceChip {
      StatusChip(
        title: sourceChip.title,
        tint: sourceChip.tint,
        systemImage: sourceChip.systemImage
      )
    }
  }

  @ViewBuilder
  private var secondaryStatusChips: some View {
    if result.matchedAppId != nil {
      ChannelPicker(result: result)
    }

    if let confidence = result.matchConfidence {
      StatusChip(
        title: VersionFormatting.confidenceLabel(confidence),
        tint: .secondary,
        systemImage: "scope"
      )
    }
  }

  private var hasSecondaryStatusChips: Bool {
    result.matchedAppId != nil || result.matchConfidence != nil
  }

  private var sourceChip: (title: String, tint: Color, systemImage: String)? {
    if isBrewApp {
      return ("Homebrew", .green, "mug.fill")
    }
    if installedApp?.isMasApp == true {
      return ("Mac App Store", .secondary, "apple.logo")
    }
    return nil
  }

  private var actionCluster: some View {
    VStack(alignment: .trailing, spacing: 8) {
      HStack(spacing: 8) {
        if actionPresentation.showsSecondaryOpenButton {
          secondaryOpenAppButton
        }

        moreMenu

        if !installState.isRunning {
          primaryActionButton
        }
      }

      if installState.isRunning {
        Text(installPresentation.statusTitle ?? installState.phase.rawValue.capitalized)
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
      }
    }
  }

  private var primaryActionButton: some View {
    Button(action: performPrimaryAction) {
      Label(actionPresentation.title, systemImage: actionPresentation.systemImage)
        .font(.body.weight(.semibold))
        .lineLimit(1)
        .frame(minWidth: 150)
    }
    .buttonStyle(.glassProminent)
    .controlSize(.large)
    .disabled(actionPresentation.isDisabled)
  }

  private var secondaryOpenAppButton: some View {
    Button {
      appState.openApp(result)
    } label: {
      Label("Open App", systemImage: "macwindow")
        .lineLimit(1)
        .font(.callout.weight(.medium))
    }
    .buttonStyle(.glass)
    .controlSize(.regular)
    .disabled(!hasAppPath)
  }

  private var moreMenu: some View {
    Menu {
      Button("Show in Finder") {
        appState.revealAppInFinder(result)
      }
      .disabled(!hasAppPath)

      Button("Report Issue") {
        showFeedbackSheet = true
      }

      Divider()

      Button("Copy Bundle ID") {
        appState.copyBundleId(result)
      }
      .disabled(appState.bundleIdText(for: result) == nil)

      Button("Copy Path") {
        appState.copyAppPath(result)
      }
      .disabled(!hasAppPath)

      if isBrewApp && result.canInstall && result.decision == .updateAvailable {
        Divider()

        Button("Install Directly...") {
          showBrewBypassWarning = true
        }
        .disabled(installState.isRunning)
      }
    } label: {
      Label("More", systemImage: "ellipsis.circle")
        .labelStyle(.iconOnly)
        .frame(width: 26, height: 22)
    }
    .menuStyle(.button)
    .buttonStyle(.glass)
    .controlSize(.regular)
    .help("More actions")
    .accessibilityLabel("More actions")
  }

  private var callouts: [DetailCallout] {
    var callouts: [DetailCallout] = []

    if isUserIgnored {
      callouts.append(
        DetailCallout(
          id: "ignored",
          title: "Ignored",
          detail: "This app stays out of normal result sections and bulk updates.",
          tone: .neutral
        )
      )
    }

    switch installState.phase {
    case .failed:
      callouts.append(
        DetailCallout(
          id: "failed",
          title: "Install Failed",
          detail: installState.errorMessage ?? installState.detail,
          tone: .failure
        )
      )
    case .completed:
      callouts.append(
        DetailCallout(
          id: "completed",
          title: "Install Complete",
          detail: installPresentation.statusDetail ?? "Versioneer finished the update flow.",
          tone: .success
        )
      )
    default:
      break
    }

    if result.isLocalOnly {
      callouts.append(
        DetailCallout(
          id: "local-only",
          title: result.localOnlyStatusTitle,
          detail: result.localOnlyDescription,
          tone: result.decision == .updateAvailable ? .warning : .neutral
        )
      )
    }

    if let installTrustDetail {
      callouts.append(
        DetailCallout(
          id: "install-trust",
          title: "Trust Material Required",
          detail: installTrustDetail,
          tone: .warning
        )
      )
    }

    if let manualUpdateAction,
      result.decision == .updateAvailable,
      !result.canInstall,
      !isMasUpgradeable,
      !isBrewApp
    {
      callouts.append(
        DetailCallout(
          id: "manual",
          title: "Manual Update",
          detail: manualUpdateAction.detail,
          tone: .neutral
        )
      )
    }

    if result.decision == .updateAvailable
      && !isMasUpgradeable
      && !isBrewApp
      && !result.canInstall
      && manualUpdateAction == nil
    {
      callouts.append(
        DetailCallout(
          id: "unavailable",
          title: "Install Unavailable",
          detail: "Versioneer does not currently have an install path for this update.",
          tone: .neutral
        )
      )
    }

    for banner in installPresentation.banners {
      callouts.append(
        DetailCallout(
          id: banner.id,
          title: banner.title,
          detail: banner.detail,
          tone: DetailCallout.Tone(banner.tone)
        )
      )
    }

    return callouts
  }

  private func performPrimaryAction() {
    switch actionPresentation.kind {
    case .stopIgnoring:
      appState.unignore(result, undoManager: undoManager)
    case .openApp:
      appState.openApp(result)
    case .masUpgrade:
      Task { await appState.masUpgrade(result) }
    case .brewUpgrade:
      Task { await appState.brewUpgrade(result) }
    case .install:
      if actionPresentation.requiresInstallWarning {
        showInstallWarning = true
      } else {
        appState.requestPrimaryUpdate(for: result)
      }
    case .manualUpdate:
      appState.openManualUpdate(result)
    case .unavailable:
      break
    }
  }
}
