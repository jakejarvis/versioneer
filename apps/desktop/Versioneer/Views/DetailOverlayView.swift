import SwiftUI

struct DetailPaneView: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

  @State private var showFeedbackSheet = false
  @State private var showInstallWarning = false
  @State private var showBrewBypassWarning = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        DetailHeroSection(result: result)

        DetailPrimaryActionSection(
          result: result,
          showInstallWarning: $showInstallWarning,
          showBrewBypassWarning: $showBrewBypassWarning
        )

        DetailQuickActionsSection(
          result: result,
          showFeedbackSheet: $showFeedbackSheet
        )

        DetailReleaseNotesSection(result: result)
      }
      .padding(24)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .sheet(isPresented: $showFeedbackSheet) {
      FeedbackSheetView(result: result)
    }
    .alert("Install provisional update?", isPresented: $showInstallWarning) {
      Button("Install", role: .destructive) {
        Task { await appState.install(result) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "This app is only provisionally verified. Versioneer will still run full local verification before installing."
      )
    }
    .alert("Install directly?", isPresented: $showBrewBypassWarning) {
      Button("Install Directly", role: .destructive) {
        Task { await appState.install(result) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "This app was installed via Homebrew. Installing directly may cause Homebrew to lose track of it. You can re-sync with `brew reinstall --cask`."
      )
    }
  }
}

// MARK: - Hero Section

private struct DetailHeroSection: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

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
    VStack(alignment: .leading, spacing: 14) {
      HStack(alignment: .top, spacing: 16) {
        Image(nsImage: appState.appIcon(for: result))
          .resizable()
          .aspectRatio(contentMode: .fit)
          .frame(width: 56, height: 56)

        VStack(alignment: .leading, spacing: 6) {
          Text(result.matchedAppName ?? result.appName)
            .font(.title3.weight(.semibold))
            .lineLimit(2)

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

        Spacer(minLength: 0)

        MetadataPopoverButton(result: result)
      }

      GlassEffectContainer(spacing: 8) {
        HStack(spacing: 8) {
          StatusChip(
            title: decisionTitle,
            tint: decisionTint,
            systemImage: decisionSymbol
          )

          if appState.isHomebrewInstalled(for: result) {
            StatusChip(
              title: "Homebrew",
              tint: .green,
              systemImage: "mug.fill"
            )
          }

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

          if let releasedAt = result.releasedAt {
            Text(VersionFormatting.relativeDate(from: releasedAt))
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
      }

      if result.isLocalOnly {
        GlassBanner(
          title: result.localOnlyStatusTitle,
          detail: result.localOnlyDescription,
          tint: result.decision == .updateAvailable ? .orange : .secondary
        )
      }
    }
  }
}

// MARK: - Primary Action Section

private struct DetailPrimaryActionSection: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator

  let result: AppDecision

  @Binding var showInstallWarning: Bool
  @Binding var showBrewBypassWarning: Bool

  private var installState: InstallCoordinator.OperationState {
    installCoordinator.state(for: result)
  }

  private var installPresentation: InstallPresentation {
    InstallPresentation.make(result: result, state: installState)
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

  private var manualUpdateAction: (title: String, detail: String, url: URL)? {
    appState.manualUpdateAction(for: result)
  }

  @ViewBuilder
  var body: some View {
    if isUserIgnored {
      ignoredActionCard
    } else if isMasUpgradeable && result.decision == .updateAvailable {
      masUpgradeCard
    } else if isBrewApp && result.decision == .updateAvailable {
      brewUpgradeCard
    } else if result.canInstall {
      standardInstallCard
    } else if let action = manualUpdateAction, result.decision == .updateAvailable {
      manualUpdateCard(action: action)
    } else if result.decision == .updateAvailable {
      unavailableInstallCard
    }
  }

  // MARK: - Action Cards

  private var ignoredActionCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      SectionHeader(
        title: "Ignored",
        subtitle:
          "Versioneer will keep this app out of the normal result sections until you remove its ignore rule."
      )

      Button("Stop Ignoring") {
        appState.unignore(result)
      }
      .buttonStyle(.glassProminent)
      .controlSize(.large)
    }
    .glassCard(interactive: true, cornerRadius: 22, padding: 18)
  }

  private var masUpgradeCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      if installState.isRunning {
        if let progress = installPresentation.progress {
          InstallProgressView(progress: progress)
        }
        if let statusDetail = installPresentation.statusDetail, !statusDetail.isEmpty {
          Text(statusDetail)
            .font(.callout)
            .foregroundStyle(.secondary)
        }
      }

      if installState.phase == .completed {
        Label("Updated via Mac App Store", systemImage: "checkmark.circle.fill")
          .font(.callout.weight(.semibold))
          .foregroundStyle(.green)
      } else if installState.phase == .failed {
        VStack(alignment: .leading, spacing: 4) {
          Label("Mac App Store upgrade failed", systemImage: "xmark.circle.fill")
            .font(.callout.weight(.semibold))
            .foregroundStyle(.red)
          if let error = installState.errorMessage {
            Text(error)
              .font(.caption)
              .foregroundStyle(.secondary)
              .textSelection(.enabled)
          }
        }
      }

      Button {
        Task { await appState.masUpgrade(result) }
      } label: {
        Label("Update via Mac App Store", systemImage: "apple.logo")
          .font(.body.weight(.semibold))
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.glassProminent)
      .controlSize(.large)
      .disabled(installState.isRunning)

      Label(
        "This app was installed from the Mac App Store. Updating through mas keeps the App Store in sync.",
        systemImage: "info.circle"
      )
      .font(.caption)
      .foregroundStyle(.secondary)
    }
    .glassCard(interactive: true, cornerRadius: 22, padding: 18)
  }

  private var brewUpgradeCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      if installState.isRunning {
        if let progress = installPresentation.progress {
          InstallProgressView(progress: progress)
        }
        if let statusDetail = installPresentation.statusDetail, !statusDetail.isEmpty {
          Text(statusDetail)
            .font(.callout)
            .foregroundStyle(.secondary)
        }
      }

      if installState.phase == .completed {
        Label("Updated via Homebrew", systemImage: "checkmark.circle.fill")
          .font(.callout.weight(.semibold))
          .foregroundStyle(.green)
      } else if installState.phase == .failed {
        VStack(alignment: .leading, spacing: 4) {
          Label("Homebrew upgrade failed", systemImage: "xmark.circle.fill")
            .font(.callout.weight(.semibold))
            .foregroundStyle(.red)
          if let error = installState.errorMessage {
            Text(error)
              .font(.caption)
              .foregroundStyle(.secondary)
              .textSelection(.enabled)
          }
        }
      }

      Button {
        Task { await appState.brewUpgrade(result) }
      } label: {
        Label("Update via Homebrew", systemImage: "mug.fill")
          .font(.body.weight(.semibold))
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.glassProminent)
      .controlSize(.large)
      .disabled(installState.isRunning)

      if result.canInstall {
        Button {
          showBrewBypassWarning = true
        } label: {
          Text("Install directly instead")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.link)
      }

      Label(
        "This app was installed via Homebrew. Updating through brew keeps your package manager in sync.",
        systemImage: "info.circle"
      )
      .font(.caption)
      .foregroundStyle(.secondary)
    }
    .glassCard(interactive: true, cornerRadius: 22, padding: 18)
  }

  private var standardInstallCard: some View {
    VStack(alignment: .leading, spacing: 14) {
      ForEach(installPresentation.banners) { banner in
        GlassBanner(
          title: banner.title,
          detail: banner.detail,
          tint: tint(for: banner.tone)
        )
      }

      if let progress = installPresentation.progress {
        InstallProgressView(progress: progress)
      }

      if let statusDetail = installPresentation.statusDetail,
        !statusDetail.isEmpty
      {
        Text(statusDetail)
          .font(.callout)
          .foregroundStyle(.secondary)
      }

      Button(action: handlePrimaryInstallAction) {
        Text(installPresentation.primaryActionTitle)
          .font(.body.weight(.semibold))
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.glassProminent)
      .controlSize(.large)
      .disabled(installPresentation.primaryActionDisabled)

      if let recoveryAction = installPresentation.recoveryAction {
        Button(installCoordinator.recoveryActionTitle(recoveryAction)) {
          installCoordinator.performRecoveryAction(recoveryAction)
        }
        .buttonStyle(.link)
      }

      if !installPresentation.trustSummary.isEmpty {
        VStack(alignment: .leading, spacing: 6) {
          ForEach(installPresentation.trustSummary, id: \.self) { item in
            Label(item, systemImage: "checkmark.seal")
              .font(.caption)
              .foregroundStyle(.secondary)
          }
        }
      }
    }
    .glassCard(interactive: true, cornerRadius: 22, padding: 18)
  }

  private func manualUpdateCard(
    action: (title: String, detail: String, url: URL)
  ) -> some View {
    VStack(alignment: .leading, spacing: 14) {
      SectionHeader(
        title: "Manual Update",
        subtitle: action.detail
      )

      Button {
        appState.openManualUpdate(result)
      } label: {
        Label(action.title, systemImage: "arrow.up.forward.app")
          .font(.body.weight(.semibold))
          .frame(maxWidth: .infinity)
      }
      .buttonStyle(.glassProminent)
      .controlSize(.large)
      .disabled(installState.isRunning)

      Text(action.url.absoluteString)
        .font(.caption.monospaced())
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
    }
    .glassCard(interactive: true, cornerRadius: 22, padding: 18)
  }

  private var unavailableInstallCard: some View {
    VStack(alignment: .leading, spacing: 8) {
      Text("Install Unavailable")
        .font(.subheadline.weight(.semibold))
      Text(
        result.installStrategy == nil
          ? "Versioneer does not currently have an install path for this update."
          : "Versioneer is ready to run the install flow for this update."
      )
      .font(.callout)
      .foregroundStyle(.secondary)
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .glassCard(cornerRadius: 18, padding: 16)
  }

  // MARK: - Helpers

  private func tint(for tone: InstallPresentation.Tone) -> Color {
    switch tone {
    case .neutral: .secondary
    case .progress: .accentColor
    case .success: .green
    case .warning: .orange
    case .failure: .red
    }
  }

  private func handlePrimaryInstallAction() {
    guard result.canInstall else { return }
    if !result.isVerified {
      showInstallWarning = true
    } else {
      Task { await appState.install(result) }
    }
  }
}

// MARK: - Quick Actions Section

private struct DetailQuickActionsSection: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

  @Binding var showFeedbackSheet: Bool

  private var hasAppPath: Bool {
    appState.appPathText(for: result) != nil
  }

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      SectionHeader(title: "Quick Actions")

      ViewThatFits(in: .horizontal) {
        HStack(spacing: 10) {
          openAppButton
          showInFinderButton
          reportIssueButton
        }

        VStack(alignment: .leading, spacing: 10) {
          openAppButton
          showInFinderButton
          reportIssueButton
        }
      }
    }
    .glassCard(cornerRadius: 18, padding: 16)
  }

  private var openAppButton: some View {
    Button("Open App") {
      appState.openApp(result)
    }
    .buttonStyle(.glass)
    .disabled(!hasAppPath)
  }

  private var showInFinderButton: some View {
    Button("Show in Finder") {
      appState.revealAppInFinder(result)
    }
    .buttonStyle(.glass)
    .disabled(!hasAppPath)
  }

  private var reportIssueButton: some View {
    Button("Report Issue") {
      showFeedbackSheet = true
    }
    .buttonStyle(.glass)
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
    if result.latestReleaseId != nil {
      VStack(alignment: .leading, spacing: 12) {
        Text("What's New")
          .font(.subheadline.weight(.semibold))

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
              .overlay(alignment: .top) {
                releaseNotesFade(startPoint: .top, endPoint: .bottom)
              }
              .overlay(alignment: .bottom) {
                releaseNotesFade(startPoint: .bottom, endPoint: .top)
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
      .task(id: result.latestReleaseId) {
        await loadReleaseNotes()
      }
    }
  }

  private func releaseNotesFade(startPoint: UnitPoint, endPoint: UnitPoint) -> some View {
    LinearGradient(
      colors: [Color(nsColor: .windowBackgroundColor), .clear],
      startPoint: startPoint,
      endPoint: endPoint
    )
    .frame(height: 18)
    .allowsHitTesting(false)
  }

  private func loadReleaseNotes() async {
    guard let releaseId = result.latestReleaseId else {
      releaseNotes = nil
      return
    }
    releaseNotesLoading = true
    releaseNotes = nil
    releaseNotes = await appState.fetchReleaseNotes(releaseId: releaseId)
    releaseNotesLoading = false
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
