import SwiftUI

struct DetailPaneView: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator

  let result: AppDecision

  @State private var showFeedbackSheet = false
  @State private var showInstallWarning = false
  @State private var showBrewBypassWarning = false
  @State private var feedbackType: FeedbackType = .wrongMatch
  @State private var feedbackComment = ""
  @State private var feedbackVersion = ""
  @State private var feedbackURL = ""
  @State private var feedbackSubmitting = false
  @State private var feedbackError: String?
  @State private var feedbackSuccess = false
  @State private var releaseNotes: ReleaseNotesContent?
  @State private var releaseNotesLoading = false

  private var installState: InstallCoordinator.OperationState {
    installCoordinator.state(for: result)
  }

  private var installPresentation: InstallPresentation {
    InstallPresentation.make(result: result, state: installState)
  }

  private var isUserIgnored: Bool {
    appState.isUserIgnored(result)
  }

  private var hasPrimaryActionSection: Bool {
    isUserIgnored || (isBrewApp && result.decision == .updateAvailable)
      || result.canInstall || result.decision == .updateAvailable
  }

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 20) {
        heroSection

        if hasPrimaryActionSection {
          primaryActionSection
        }

        secondaryActionSection
        releaseNotesSection
      }
      .padding(24)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .sheet(isPresented: $showFeedbackSheet) {
      FeedbackSheetView(
        feedbackType: $feedbackType,
        feedbackComment: $feedbackComment,
        feedbackVersion: $feedbackVersion,
        feedbackURL: $feedbackURL,
        feedbackSubmitting: $feedbackSubmitting,
        feedbackError: $feedbackError,
        feedbackSuccess: $feedbackSuccess,
        onCancel: resetFeedbackState,
        onSubmit: { Task { await submitFeedback() } }
      )
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
    .task(id: result.latestReleaseId) {
      await loadReleaseNotes()
    }
    .onChange(of: feedbackSuccess) {
      guard feedbackSuccess else { return }
      Task {
        try? await Task.sleep(for: .seconds(2))
        resetFeedbackState()
      }
    }
  }

  // MARK: - Hero Section

  private var heroSection: some View {
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

  // MARK: - Action Sections

  private var isBrewApp: Bool {
    appState.isHomebrewInstalled(for: result)
  }

  @ViewBuilder
  private var primaryActionSection: some View {
    if isUserIgnored {
      ignoredActionSection
    } else if isBrewApp && result.decision == .updateAvailable {
      brewUpgradeActionSection
    } else if result.canInstall {
      standardInstallActionSection
    } else if result.decision == .updateAvailable {
      VStack(alignment: .leading, spacing: 8) {
        Text("Install Unavailable")
          .font(.subheadline.weight(.semibold))
        Text(unavailableInstallReason)
          .font(.callout)
          .foregroundStyle(.secondary)
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .glassCard(cornerRadius: 18, padding: 16)
    }
  }

  private var ignoredActionSection: some View {
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

  private var brewUpgradeActionSection: some View {
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

  private var standardInstallActionSection: some View {
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

      Button {
        handlePrimaryInstallAction()
      } label: {
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

  private var secondaryActionSection: some View {
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
    .disabled(appState.appPathText(for: result) == nil)
  }

  private var showInFinderButton: some View {
    Button("Show in Finder") {
      appState.revealAppInFinder(result)
    }
    .buttonStyle(.glass)
    .disabled(appState.appPathText(for: result) == nil)
  }

  private var reportIssueButton: some View {
    Button("Report Issue") {
      showFeedbackSheet = true
      feedbackError = nil
      feedbackSuccess = false
    }
    .buttonStyle(.glass)
  }

  // MARK: - Release Notes Section

  @ViewBuilder
  private var releaseNotesSection: some View {
    if result.latestReleaseId != nil {
      VStack(alignment: .leading, spacing: 12) {
        Text("What's New")
          .font(.subheadline.weight(.semibold))

        if releaseNotesLoading {
          HStack(spacing: 8) {
            ProgressView()
              .controlSize(.small)
            Text("Loading release notes…")
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

  // MARK: - Helpers

  private var decisionTitle: String {
    if result.isLocalOnly {
      return result.localOnlyStatusTitle
    }
    switch result.decision {
    case .updateAvailable:
      return "Update Available"
    case .upToDate:
      return "Up to Date"
    case .ambiguous:
      return "Needs Review"
    case .localOnly:
      return "Local Only"
    }
  }

  private var decisionTint: Color {
    if result.isLocalOnly {
      return result.decision == .updateAvailable ? .orange : .secondary
    }
    switch result.decision {
    case .updateAvailable:
      return .accentColor
    case .upToDate:
      return .green
    case .ambiguous:
      return .orange
    case .localOnly:
      return .secondary
    }
  }

  private var decisionSymbol: String {
    if result.isLocalOnly {
      return result.decision == .updateAvailable ? "arrow.up.circle" : "desktopcomputer"
    }
    switch result.decision {
    case .updateAvailable:
      return "arrow.up.circle.fill"
    case .upToDate:
      return "checkmark.circle.fill"
    case .ambiguous:
      return "scope"
    case .localOnly:
      return "desktopcomputer"
    }
  }

  private var unavailableInstallReason: String {
    if result.installStrategy == nil {
      "Versioneer does not currently have an install path for this update."
    } else {
      "Versioneer is ready to run the install flow for this update."
    }
  }

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

  private func resetFeedbackState() {
    showFeedbackSheet = false
    feedbackComment = ""
    feedbackVersion = ""
    feedbackURL = ""
    feedbackError = nil
    feedbackSuccess = false
    feedbackSubmitting = false
  }

  private func submitFeedback() async {
    feedbackSubmitting = true
    feedbackError = nil

    do {
      switch feedbackType {
      case .wrongMatch:
        try await appState.submitWrongMatch(
          for: result,
          comment: feedbackComment.isEmpty ? nil : feedbackComment
        )
      case .wrongVersion:
        try await appState.submitWrongVersion(
          for: result,
          reportedVersion: feedbackVersion.isEmpty ? nil : feedbackVersion,
          comment: feedbackComment.isEmpty ? nil : feedbackComment
        )
      case .missingApp:
        try await appState.submitMissingApp(
          for: result,
          homepageUrl: feedbackURL.isEmpty ? nil : feedbackURL,
          comment: feedbackComment.isEmpty ? nil : feedbackComment
        )
      }
      feedbackSuccess = true
    } catch {
      feedbackError = error.localizedDescription
    }

    feedbackSubmitting = false
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

  private var channelTint: Color {
    switch currentChannel {
    case "stable": .secondary
    case "beta": .orange
    case "nightly": .purple
    default: .blue
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
