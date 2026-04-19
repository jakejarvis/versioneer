import SwiftUI

struct DetailPaneView: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

  @State private var showFeedbackSheet = false
  @State private var showInstallWarning = false
  @State private var showBrewBypassWarning = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        DetailSummaryPanel(
          result: result,
          showFeedbackSheet: $showFeedbackSheet,
          showInstallWarning: $showInstallWarning,
          showBrewBypassWarning: $showBrewBypassWarning
        )

        DetailFactsSection(result: result)
        DetailReleaseNotesSection(result: result)
      }
      .padding(24)
      .frame(maxWidth: 640, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .sheet(isPresented: $showFeedbackSheet) {
      FeedbackSheetView(result: result)
    }
    .alert("Install unverified update?", isPresented: $showInstallWarning) {
      Button("Install Update", role: .destructive) {
        Task { await appState.install(result) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "Versioneer will run local verification before installing, but this catalog match still needs review."
      )
    }
    .alert("Install directly?", isPresented: $showBrewBypassWarning) {
      Button("Install Directly", role: .destructive) {
        Task { await appState.install(result) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "This app was installed with Homebrew. Installing directly can leave Homebrew out of sync."
      )
    }
  }
}

// MARK: - Summary Panel

private struct DetailSummaryPanel: View {
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

  private var manualUpdateAction: (title: String, detail: String, url: URL)? {
    appState.manualUpdateAction(for: result)
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
        if showsSecondaryOpenButton {
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

  private var showsSecondaryOpenButton: Bool {
    !installState.isRunning && hasUpdateAction && hasAppPath && !isUserIgnored
  }

  private var hasUpdateAction: Bool {
    result.decision == .updateAvailable
      && (isMasUpgradeable || isBrewApp || result.canInstall || manualUpdateAction != nil)
  }

  private var primaryActionTitle: String {
    if isUserIgnored {
      return "Stop Ignoring"
    }
    if installState.phase == .completed {
      return "Open App"
    }
    if installState.phase == .failed && hasUpdateAction {
      return "Retry Install"
    }
    if result.decision == .updateAvailable {
      if isMasUpgradeable {
        return "Update via Mac App Store"
      }
      if isBrewApp {
        return "Update via Homebrew"
      }
      if result.canInstall {
        return installPresentation.primaryActionTitle
      }
      if let manualUpdateAction {
        return manualUpdateAction.title
      }
      return "Install Unavailable"
    }
    return "Open App"
  }

  private var primaryActionSystemImage: String {
    if isUserIgnored {
      return "minus.circle"
    }
    if installState.phase == .failed && hasUpdateAction {
      return "arrow.clockwise"
    }
    if installState.phase == .completed || result.decision != .updateAvailable {
      return "macwindow"
    }
    if isMasUpgradeable {
      return "apple.logo"
    }
    if isBrewApp {
      return "mug.fill"
    }
    if manualUpdateAction != nil && !result.canInstall {
      return "arrow.up.forward.app"
    }
    return "arrow.down.circle"
  }

  private var primaryActionDisabled: Bool {
    if isUserIgnored {
      return false
    }
    if installState.isRunning {
      return true
    }
    if installState.phase == .failed {
      return !hasUpdateAction
    }
    if installState.phase == .completed || result.decision != .updateAvailable {
      return !hasAppPath
    }
    if result.decision == .updateAvailable {
      return !(isMasUpgradeable || isBrewApp || result.canInstall || manualUpdateAction != nil)
    }
    return false
  }

  private var primaryActionButton: some View {
    Button(action: performPrimaryAction) {
      Label(primaryActionTitle, systemImage: primaryActionSystemImage)
        .font(.body.weight(.semibold))
        .lineLimit(1)
        .frame(minWidth: 150)
    }
    .buttonStyle(.glassProminent)
    .controlSize(.large)
    .disabled(primaryActionDisabled)
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

        Button("Install Directly…") {
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
    if isUserIgnored {
      appState.unignore(result, undoManager: undoManager)
      return
    }

    if installState.phase == .completed || result.decision != .updateAvailable {
      appState.openApp(result)
      return
    }

    if isMasUpgradeable {
      Task { await appState.masUpgrade(result) }
    } else if isBrewApp {
      Task { await appState.brewUpgrade(result) }
    } else if result.canInstall {
      if !result.isVerified {
        showInstallWarning = true
      } else {
        Task { await appState.install(result) }
      }
    } else if manualUpdateAction != nil {
      appState.openManualUpdate(result)
    }
  }
}

private struct DetailCallout: Identifiable {
  enum Tone {
    case neutral
    case progress
    case success
    case warning
    case failure

    init(_ tone: InstallPresentation.Tone) {
      switch tone {
      case .neutral: self = .neutral
      case .progress: self = .progress
      case .success: self = .success
      case .warning: self = .warning
      case .failure: self = .failure
      }
    }

    var tint: Color {
      switch self {
      case .neutral: .secondary
      case .progress: .accentColor
      case .success: .green
      case .warning: .orange
      case .failure: .red
      }
    }

    var systemImage: String {
      switch self {
      case .neutral: "info.circle.fill"
      case .progress: "arrow.trianglehead.2.clockwise"
      case .success: "checkmark.circle.fill"
      case .warning: "exclamationmark.triangle.fill"
      case .failure: "xmark.circle.fill"
      }
    }
  }

  let id: String
  let title: String
  let detail: String
  let tone: Tone
}

private struct DetailCalloutGroup: View {
  let callouts: [DetailCallout]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(callouts) { callout in
        HStack(alignment: .top, spacing: 10) {
          Image(systemName: callout.tone.systemImage)
            .font(.callout.weight(.semibold))
            .foregroundStyle(callout.tone.tint)
            .frame(width: 18)

          VStack(alignment: .leading, spacing: 2) {
            Text(callout.title)
              .font(.callout.weight(.semibold))
            Text(callout.detail)
              .font(.caption)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }

          Spacer(minLength: 0)
        }
      }
    }
    .padding(12)
    .background(Color.primary.opacity(0.045), in: .rect(cornerRadius: 14))
    .overlay {
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
    }
  }
}

private struct DetailInlineProgressView: View {
  let progress: InstallPresentation.Progress
  let detail: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(progress.title)
          .font(.callout.weight(.semibold))
        Spacer()
        Text("Step \(progress.currentStep) of \(progress.totalSteps)")
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      ProgressView(value: Double(progress.currentStep), total: Double(progress.totalSteps))
        .progressViewStyle(.linear)
        .tint(.accentColor)

      if let detail, !detail.isEmpty {
        Text(detail)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }
}

// MARK: - Details Section

private struct DetailFactsSection: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

  private var installedApp: InstalledApp? {
    appState.installedApp(for: result)
  }

  private var manualUpdateAction: (title: String, detail: String, url: URL)? {
    appState.manualUpdateAction(for: result)
  }

  private var facts: [DetailFact] {
    var facts: [DetailFact] = [
      DetailFact(label: "Source", value: sourceDescription),
      DetailFact(label: "Install Route", value: installRouteDescription),
      DetailFact(label: "Path", value: appState.appPathText(for: result) ?? "Unavailable"),
      DetailFact(label: "Bundle ID", value: appState.bundleIdText(for: result) ?? "Unavailable"),
      DetailFact(label: "Released", value: VersionFormatting.relativeDate(from: result.releasedAt)),
    ]

    if let matchConfidence = result.matchConfidence {
      facts.append(
        DetailFact(label: "Match", value: VersionFormatting.confidenceLabel(matchConfidence)))
    }

    if shouldShowChannel {
      facts.append(DetailFact(label: "Channel", value: currentChannel.capitalized))
    }

    if let artifact = result.artifact {
      if let sizeBytes = artifact.sizeBytes {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        facts.append(
          DetailFact(label: "Download", value: formatter.string(fromByteCount: Int64(sizeBytes)))
        )
      }
      if let minOS = artifact.minOsVersion {
        facts.append(DetailFact(label: "Minimum macOS", value: minOS))
      }
    }

    return facts
  }

  var body: some View {
    DetailPlainSection(title: "Details") {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(facts) { fact in
          DetailFactRowView(fact: fact)
        }
      }
    }
  }

  private var sourceDescription: String {
    if appState.isUserIgnored(result) {
      return "Ignored"
    }
    if appState.isHomebrewInstalled(for: result) {
      return "Homebrew"
    }
    if installedApp?.isMasApp == true {
      return "Mac App Store"
    }
    if installedApp?.isSparkleApp == true {
      return "Sparkle"
    }
    if installedApp?.isElectronApp == true {
      return "Electron"
    }
    return result.isVerified ? "Versioneer Catalog" : "Local Metadata"
  }

  private var installRouteDescription: String {
    if result.decision != .updateAvailable {
      return "No update required"
    }
    if appState.isMasUpgradeable(for: result) {
      return "Mac App Store"
    }
    if appState.isHomebrewInstalled(for: result) {
      return "Homebrew"
    }
    if let strategy = result.installStrategy {
      var parts = [strategy.displayTitle]
      if strategy.requiresAdmin {
        parts.append("admin required")
      }
      if strategy.requiresQuit {
        parts.append("quits app first")
      }
      return parts.joined(separator: " · ")
    }
    if manualUpdateAction != nil {
      return "Manual"
    }
    return "Unavailable"
  }

  private var shouldShowChannel: Bool {
    result.matchedAppId != nil
      && ((result.availableChannels?.count ?? 0) > 1 || result.channel != nil)
  }

  private var currentChannel: String {
    guard let appId = result.matchedAppId else { return result.channel ?? "stable" }
    return appState.settings.channel(forAppId: appId)
  }
}

private struct DetailFact: Identifiable {
  let label: String
  let value: String

  var id: String { label }
}

private struct DetailFactRowView: View {
  let fact: DetailFact

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 14) {
      Text(fact.label)
        .foregroundStyle(.secondary)
        .frame(width: 112, alignment: .leading)

      Text(fact.value)
        .foregroundStyle(.primary)
        .lineLimit(2)
        .truncationMode(.middle)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .font(.callout)
  }
}

// MARK: - Release Notes Section

private struct DetailReleaseNotesSection: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

  @State private var releaseNotes: ReleaseNotesContent?
  @State private var releaseNotesLoading = false

  @ViewBuilder
  var body: some View {
    DetailPlainSection(title: "What's New") {
      VStack(alignment: .leading, spacing: 12) {
        if releaseNotesLoading {
          HStack(spacing: 8) {
            ProgressView()
              .controlSize(.small)
            Text("Loading release notes\u{2026}")
              .font(.callout)
              .foregroundStyle(.secondary)
          }
        } else if let releaseNotes {
          if let html = releaseNotes.html, !html.isEmpty {
            ReleaseNotesWebView(html: html)
              .frame(minHeight: 100, maxHeight: 300)
              .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
              .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                  .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
              }
              .mask {
                VStack(spacing: 0) {
                  Rectangle().fill(.black)
                  LinearGradient(colors: [.black, .clear], startPoint: .top, endPoint: .bottom)
                    .frame(height: 18)
                }
              }
          } else {
            Text("No release notes available.")
              .font(.callout)
              .foregroundStyle(.secondary)
          }

          if let url = releaseNotes.url {
            Link("View Full Release Notes", destination: url)
              .buttonStyle(.link)
          }
        } else {
          Text("No release notes available.")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
      }
    }
    .task(id: result.latestReleaseId) {
      await loadReleaseNotes()
    }
  }

  private func loadReleaseNotes() async {
    guard let releaseId = result.latestReleaseId else {
      releaseNotes = nil
      releaseNotesLoading = false
      return
    }
    releaseNotesLoading = true
    releaseNotes = nil
    let notes = await appState.fetchReleaseNotes(releaseId: releaseId)
    guard !Task.isCancelled else { return }
    releaseNotes = notes
    releaseNotesLoading = false
  }
}

private struct DetailPlainSection<Content: View>: View {
  let title: String
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title)
        .font(.subheadline.weight(.semibold))

      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}

extension InstallStrategy {
  fileprivate nonisolated var displayTitle: String {
    switch self {
    case .sparkle:
      "Sparkle"
    case .zipReplace:
      "Extract"
    case .dmgCopyReplace:
      "DMG Mount"
    case .pkgInstall:
      "Installer"
    case .macAppStore:
      "Mac App Store"
    case .manualOnly:
      "Manual"
    }
  }
}

// MARK: - Channel Picker

private struct ChannelPicker: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

  private var channels: [String] {
    result.availableChannels ?? ["stable"]
  }

  private var currentChannel: String {
    guard let appId = result.matchedAppId else { return "stable" }
    return appState.settings.channel(forAppId: appId)
  }

  private var channelTint: Color {
    switch currentChannel {
    case "stable": .secondary
    case "beta": .orange
    case "nightly": .purple
    default: .blue
    }
  }

  var body: some View {
    if channels.count > 1 {
      Menu {
        ForEach(channels, id: \.self) { channel in
          Button {
            setChannel(channel)
          } label: {
            if channel == currentChannel {
              Label(channel.capitalized, systemImage: "checkmark")
            } else {
              Text(channel.capitalized)
            }
          }
        }
      } label: {
        StatusChip(
          title: currentChannel.capitalized,
          tint: channelTint,
          systemImage: "antenna.radiowaves.left.and.right",
          interactive: true
        )
      }
      .menuStyle(.borderlessButton)
      .fixedSize()
    } else if let channel = result.channel, channel != "stable" {
      StatusChip(
        title: channel.capitalized,
        tint: channelTint,
        systemImage: "antenna.radiowaves.left.and.right"
      )
    }
  }

  private func setChannel(_ channel: String) {
    guard let appId = result.matchedAppId else { return }
    if channel == "stable" {
      appState.settings.removeChannelOverride(forAppId: appId)
    } else {
      appState.settings.setChannel(channel, forAppId: appId)
    }
  }
}
