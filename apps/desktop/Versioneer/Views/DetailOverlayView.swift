import SwiftUI

struct DetailOverlayView: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator

  var body: some View {
    if let result = appState.detailResult {
      ZStack {
        // Dimmed backdrop — fade only, tap to dismiss
        Color.black.opacity(0.3)
          .ignoresSafeArea()
          .transition(.opacity)
          .onTapGesture {
            withAnimation(.spring(duration: 0.3)) {
              appState.closeDetail()
            }
          }

        // Detail card — fade + scale
        DetailCardView(result: result)
          .frame(maxWidth: 460)
          .frame(maxHeight: .infinity)
          .padding(.vertical, 24)
          .padding(.horizontal, 20)
          .transition(.opacity.combined(with: .scale(scale: 0.95)))
      }
    }
  }
}

// MARK: - Detail Card

private struct DetailCardView: View {
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
  @State private var releaseNotesHtml: String?
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

  var body: some View {
    VStack(spacing: 0) {
      // Close button row
      HStack {
        Spacer()
        Button {
          withAnimation(.spring(duration: 0.3)) {
            appState.closeDetail()
          }
        } label: {
          Image(systemName: "xmark.circle.fill")
            .font(.title2)
            .symbolRenderingMode(.hierarchical)
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
      }
      .padding(.horizontal, 16)
      .padding(.top, 12)
      .padding(.bottom, 2)

      // Scrollable content
      ScrollView {
        VStack(alignment: .leading, spacing: 20) {
          heroSection
          actionSection
          releaseNotesSection
          footerSection
        }
        .padding(.horizontal, 20)
        .padding(.bottom, 20)
      }
    }
    .glassEffect(.regular, in: .rect(cornerRadius: 22))
    .task(id: result.latestReleaseId) {
      await loadReleaseNotes()
    }
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
    .onChange(of: feedbackSuccess) {
      guard feedbackSuccess else { return }
      Task {
        try? await Task.sleep(for: .seconds(1.2))
        resetFeedbackState()
      }
    }
  }

  // MARK: - Hero Section

  private var heroSection: some View {
    VStack(alignment: .leading, spacing: 14) {
      HStack(spacing: 14) {
        Image(nsImage: appState.appIcon(for: result))
          .resizable()
          .aspectRatio(contentMode: .fit)
          .frame(width: 48, height: 48)

        VStack(alignment: .leading, spacing: 4) {
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
    }
  }

  // MARK: - Action Section

  private var isBrewApp: Bool {
    appState.isHomebrewInstalled(for: result)
  }

  @ViewBuilder
  private var actionSection: some View {
    if isUserIgnored {
      ignoredActionSection
    } else if isBrewApp && result.decision == .updateAvailable {
      brewUpgradeActionSection
    } else if result.install.canInstall {
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

      HStack(spacing: 10) {
        Button("Open App") {
          appState.openApp(result)
        }
        .disabled(appState.appPathText(for: result) == nil)

        Button("Show in Finder") {
          appState.revealAppInFinder(result)
        }
        .disabled(appState.appPathText(for: result) == nil)
      }
      .buttonStyle(.glass)
      .controlSize(.regular)
    }
    .glassCard(interactive: true, cornerRadius: 22, padding: 18)
  }

  // MARK: - Homebrew Upgrade Action

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

      if result.install.canInstall {
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

  // MARK: - Standard Install Action

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
        } else if let releaseNotesHtml, !releaseNotesHtml.isEmpty {
          ReleaseNotesWebView(html: releaseNotesHtml)
            .frame(minHeight: 100, maxHeight: 300)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        } else {
          Text("No release notes available.")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
      }
    }
  }

  // MARK: - Footer Section

  private var footerSection: some View {
    Button {
      showFeedbackSheet = true
      feedbackError = nil
      feedbackSuccess = false
    } label: {
      Text("Something wrong? Report an issue")
        .font(.caption)
        .foregroundStyle(.secondary)
    }
    .buttonStyle(.link)
  }

  // MARK: - Helpers

  private var decisionTitle: String {
    switch result.decision {
    case .updateAvailable: "Update Available"
    case .upToDate: "Up to Date"
    case .unknown: "Unknown"
    case .ambiguous: "Needs Review"
    case .unsupported: "Unsupported"
    case .ignored: "Ignored"
    }
  }

  private var decisionTint: Color {
    switch result.decision {
    case .updateAvailable: .orange
    case .upToDate: .green
    case .unknown, .ignored: .secondary
    case .ambiguous: .orange
    case .unsupported: .red
    }
  }

  private var decisionSymbol: String {
    switch result.decision {
    case .updateAvailable: "arrow.up.circle.fill"
    case .upToDate: "checkmark.circle.fill"
    case .unknown: "questionmark.circle"
    case .ambiguous: "scope"
    case .unsupported: "xmark.circle.fill"
    case .ignored: "minus.circle"
    }
  }

  private var unavailableInstallReason: String {
    switch result.install.eligibility {
    case .masApp: "Mac App Store apps must be updated through the App Store."
    case .manualOnly: "This app is currently configured for manual updates only."
    case .requiresWarning, .eligible:
      "Versioneer is ready to run the install flow for this update."
    case .notSupported:
      "Versioneer does not currently have an install path for this update."
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
    guard result.install.canInstall else { return }
    if result.install.eligibility == .requiresWarning {
      showInstallWarning = true
    } else {
      Task { await appState.install(result) }
    }
  }

  private func loadReleaseNotes() async {
    guard let releaseId = result.latestReleaseId else {
      releaseNotesHtml = nil
      return
    }
    releaseNotesLoading = true
    releaseNotesHtml = await appState.fetchReleaseNotes(releaseId: releaseId)
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
