import SwiftUI
import WebKit

struct AppDetailView: View {
    @Environment(AppState.self) private var appState
    @Environment(InstallCoordinator.self) private var installCoordinator

    let result: AppDecision

    @State private var showFeedbackSheet = false
    @State private var showInstallWarning = false
    @State private var feedbackType: FeedbackType = .wrongMatch
    @State private var feedbackComment = ""
    @State private var feedbackVersion = ""
    @State private var feedbackURL = ""
    @State private var feedbackSubmitting = false
    @State private var feedbackError: String?
    @State private var feedbackSuccess = false
    @State private var releaseNotesHtml: String?
    @State private var releaseNotesLoading = false
    @State private var releaseNotesExpanded = true

    enum FeedbackType: String, CaseIterable, Identifiable {
        case wrongMatch = "Wrong Match"
        case wrongVersion = "Wrong Version"
        case missingApp = "Missing App"

        var id: String { rawValue }
    }

    private var installState: InstallCoordinator.OperationState {
        installCoordinator.state(for: result)
    }

    private var installPresentation: InstallPresentation {
        InstallPresentation.make(result: result, state: installState)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                heroCard
                installCard
                metadataGrid
                if result.latestReleaseId != nil {
                    releaseNotesCard
                }
                feedbackCard
            }
            .padding(20)
        }
        .navigationTitle(result.matchedAppName ?? result.appName)
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
            Text("This app is only provisionally verified. Versioneer will still run full local verification before installing.")
        }
        .onChange(of: feedbackSuccess) {
            guard feedbackSuccess else { return }
            Task {
                try? await Task.sleep(for: .seconds(1.2))
                resetFeedbackState()
            }
        }
    }

    private var heroCard: some View {
        HStack(alignment: .top, spacing: 18) {
            Image(nsImage: appState.appIcon(for: result))
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 72, height: 72)
                .padding(6)
                .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 20, style: .continuous))

            VStack(alignment: .leading, spacing: 10) {
                VersioneerSectionHeader(
                    eyebrow: result.bundleId,
                    title: result.matchedAppName ?? result.appName,
                    subtitle: heroSubtitle
                )

                HStack(spacing: 10) {
                    VersioneerStatusChip(
                        title: decisionTitle,
                        tint: decisionTint,
                        systemImage: decisionSymbol,
                        glass: true
                    )

                    if let confidence = result.matchConfidence {
                        VersioneerStatusChip(
                            title: VersionFormatting.confidenceLabel(confidence),
                            tint: .secondary,
                            systemImage: "scope",
                            glass: true
                        )
                    }
                }
            }

            Spacer(minLength: 0)

            VStack(alignment: .trailing, spacing: 8) {
                Text("Latest")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(.secondary)
                Text(VersionFormatting.displayVersion(result.latestVersion))
                    .font(.title3.weight(.semibold))
                Text("Installed \(VersionFormatting.displayVersion(result.installedVersion))")
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
        .versioneerCard(glass: true, cornerRadius: 28, padding: 20)
    }

    private var installCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 16) {
                VersioneerSectionHeader(
                    eyebrow: "Update Flow",
                    title: result.install.canInstall ? "Install Update" : "Install Unavailable",
                    subtitle: installPresentation.statusTitle ?? unavailableInstallReason
                )

                Spacer(minLength: 0)

                if let statusTitle = installPresentation.statusTitle {
                    VersioneerStatusChip(
                        title: statusTitle,
                        tint: installTint,
                        systemImage: installSymbol,
                        showsProgress: installState.isRunning,
                        glass: true
                    )
                }
            }

            ForEach(installPresentation.banners) { banner in
                VersioneerBannerView(
                    title: banner.title,
                    detail: banner.detail,
                    tint: tint(for: banner.tone)
                )
            }

            if let progress = installPresentation.progress {
                InstallProgressView(progress: progress)
            }

            if let statusDetail = installPresentation.statusDetail,
               !statusDetail.isEmpty {
                Text(statusDetail)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 12) {
                if result.install.canInstall {
                    Button {
                        handlePrimaryInstallAction()
                    } label: {
                        Text(installPresentation.primaryActionTitle)
                            .frame(minWidth: 150)
                    }
                    .buttonStyle(.glassProminent)
                    .disabled(installPresentation.primaryActionDisabled)
                }

                Button("Report Issue…") {
                    showFeedbackSheet = true
                    feedbackError = nil
                    feedbackSuccess = false
                }
                .buttonStyle(.bordered)
            }

            if let recoveryAction = installPresentation.recoveryAction {
                Button(installCoordinator.recoveryActionTitle(recoveryAction)) {
                    installCoordinator.performRecoveryAction(recoveryAction)
                }
                .buttonStyle(.link)
            }

            if !installPresentation.trustSummary.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Trust Summary")
                        .font(.subheadline.weight(.semibold))
                    ForEach(installPresentation.trustSummary, id: \.self) { item in
                        Label(item, systemImage: "checkmark.seal")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.top, 4)
            }
        }
        .versioneerCard(glass: true, interactive: result.install.canInstall, cornerRadius: 28, padding: 20)
    }

    private var metadataGrid: some View {
        HStack(alignment: .top, spacing: 16) {
            detailSectionCard(
                eyebrow: "Versions",
                title: "Build and Release"
            ) {
                DetailFactRow(label: "Installed Version", value: VersionFormatting.displayVersion(result.installedVersion))
                DetailFactRow(label: "Latest Version", value: VersionFormatting.displayVersion(result.latestVersion))
                if let raw = result.latestVersionRaw, raw != result.latestVersion {
                    DetailFactRow(label: "Latest Raw", value: raw)
                }
                DetailFactRow(label: "Released", value: VersionFormatting.relativeDate(from: result.releasedAt))
            }

            detailSectionCard(
                eyebrow: "Identity",
                title: "Catalog Match"
            ) {
                DetailFactRow(label: "App Name", value: result.appName)
                DetailFactRow(label: "Canonical Name", value: result.matchedAppName ?? "—")
                DetailFactRow(label: "Bundle ID", value: result.bundleId ?? "—")
                if let matchedId = result.matchedAppId {
                    DetailFactRow(label: "Matched App ID", value: matchedId)
                }
                if let expectedTeamId = result.artifact?.expectedTeamId {
                    DetailFactRow(label: "Expected Team ID", value: expectedTeamId)
                }
                if let minOS = result.artifact?.minOsVersion {
                    DetailFactRow(label: "Minimum macOS", value: minOS)
                }
            }
        }
    }

    private var releaseNotesCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            Button {
                withAnimation(.snappy) { releaseNotesExpanded.toggle() }
            } label: {
                HStack(spacing: 10) {
                    VersioneerSectionHeader(
                        eyebrow: "Release Notes",
                        title: "What Changed",
                        subtitle: releaseNotesExpanded ? "Latest catalog release notes" : "Expand to read the latest notes"
                    )

                    Spacer(minLength: 0)

                    Image(systemName: releaseNotesExpanded ? "chevron.down" : "chevron.right")
                        .foregroundStyle(.secondary)
                }
            }
            .buttonStyle(.plain)

            if releaseNotesExpanded {
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
                        .frame(minHeight: 120, maxHeight: 420)
                        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                        }
                } else {
                    Text("No release notes are available for this release.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .versioneerCard(glass: false, cornerRadius: 26, padding: 18)
    }

    private var feedbackCard: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                VersioneerSectionHeader(
                    eyebrow: "Catalog Feedback",
                    title: "Help Improve This Match",
                    subtitle: "Report wrong matches, incorrect versions, or missing catalog entries directly from the detail pane."
                )
            }

            Spacer(minLength: 0)

            Button("Report Issue…") {
                showFeedbackSheet = true
            }
            .buttonStyle(.glass)
        }
        .versioneerCard(glass: true, interactive: true, cornerRadius: 24, padding: 18)
    }

    @ViewBuilder
    private func detailSectionCard<Content: View>(
        eyebrow: String,
        title: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            VersioneerSectionHeader(eyebrow: eyebrow, title: title, subtitle: nil)
            VStack(alignment: .leading, spacing: 10) {
                content()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .versioneerCard(glass: false, cornerRadius: 24, padding: 18)
    }

    private var heroSubtitle: String {
        switch result.decision {
        case .updateAvailable:
            "An update is available and ready to review."
        case .upToDate:
            "This app matches the latest known catalog release."
        case .unknown:
            "Versioneer could not confidently determine update status."
        case .ambiguous:
            "Multiple possible catalog matches need review."
        case .unsupported:
            "This app can be detected, but update support is limited."
        case .ignored:
            "This app is intentionally excluded from update handling."
        }
    }

    private var decisionTitle: String {
        switch result.decision {
        case .updateAvailable:
            "Update Available"
        case .upToDate:
            "Up to Date"
        case .unknown:
            "Unknown"
        case .ambiguous:
            "Needs Review"
        case .unsupported:
            "Unsupported"
        case .ignored:
            "Ignored"
        }
    }

    private var decisionTint: Color {
        switch result.decision {
        case .updateAvailable:
            .orange
        case .upToDate:
            .green
        case .unknown:
            .secondary
        case .ambiguous:
            .yellow
        case .unsupported:
            .red
        case .ignored:
            .secondary
        }
    }

    private var decisionSymbol: String {
        switch result.decision {
        case .updateAvailable:
            "arrow.up.circle.fill"
        case .upToDate:
            "checkmark.circle.fill"
        case .unknown:
            "questionmark.circle"
        case .ambiguous:
            "scope"
        case .unsupported:
            "xmark.circle.fill"
        case .ignored:
            "minus.circle"
        }
    }

    private var installTint: Color {
        tint(for: installPresentation.tone)
    }

    private var installSymbol: String {
        switch installPresentation.tone {
        case .neutral, .progress:
            "arrow.down.circle.fill"
        case .success:
            "checkmark.circle.fill"
        case .warning:
            "exclamationmark.triangle.fill"
        case .failure:
            "xmark.circle.fill"
        }
    }

    private var unavailableInstallReason: String {
        switch result.install.eligibility {
        case .masApp:
            "Mac App Store apps must be updated through the App Store."
        case .manualOnly:
            "This app is currently configured for manual updates only."
        case .requiresWarning, .eligible:
            "Versioneer is ready to run the install flow for this update."
        case .notSupported:
            "Versioneer does not currently have an install path for this update."
        }
    }

    private func tint(for tone: InstallPresentation.Tone) -> Color {
        switch tone {
        case .neutral:
            .secondary
        case .progress:
            .accentColor
        case .success:
            .green
        case .warning:
            .orange
        case .failure:
            .red
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

private struct InstallProgressView: View {
    let progress: InstallPresentation.Progress

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text(progress.title)
                    .font(.subheadline.weight(.semibold))
                Spacer()
                Text("Step \(progress.currentStep) of \(progress.totalSteps)")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            HStack(spacing: 8) {
                ForEach(1...progress.totalSteps, id: \.self) { step in
                    Capsule(style: .continuous)
                        .fill(step <= progress.currentStep ? Color.accentColor : Color.white.opacity(0.08))
                        .frame(height: 7)
                }
            }
        }
        .versioneerCard(glass: false, cornerRadius: 18, padding: 14)
    }
}

private struct DetailFactRow: View {
    let label: String
    let value: String

    var body: some View {
        LabeledContent(label) {
            Text(value)
                .font(.callout.monospacedDigit())
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.trailing)
        }
    }
}

private struct FeedbackSheetView: View {
    @Binding var feedbackType: AppDetailView.FeedbackType
    @Binding var feedbackComment: String
    @Binding var feedbackVersion: String
    @Binding var feedbackURL: String
    @Binding var feedbackSubmitting: Bool
    @Binding var feedbackError: String?
    @Binding var feedbackSuccess: Bool

    let onCancel: () -> Void
    let onSubmit: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VersioneerSectionHeader(
                eyebrow: "Feedback",
                title: "Report Issue",
                subtitle: "Send catalog feedback without leaving the desktop app."
            )

            Picker("Issue Type", selection: $feedbackType) {
                ForEach(AppDetailView.FeedbackType.allCases) { type in
                    Text(type.rawValue).tag(type)
                }
            }
            .pickerStyle(.segmented)

            feedbackBody

            TextField("Additional comments (optional)", text: $feedbackComment, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(4...6)

            if let feedbackError {
                Text(feedbackError)
                    .font(.callout)
                    .foregroundStyle(.red)
            }

            if feedbackSuccess {
                Label("Feedback submitted.", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }

            HStack {
                Spacer()

                Button("Cancel", action: onCancel)
                    .keyboardShortcut(.cancelAction)

                Button("Submit", action: onSubmit)
                    .keyboardShortcut(.defaultAction)
                    .disabled(feedbackSubmitting)
            }
        }
        .padding(20)
        .frame(minWidth: 440)
    }

    @ViewBuilder
    private var feedbackBody: some View {
        switch feedbackType {
        case .wrongMatch:
            Text("This app was matched to the wrong catalog entry.")
                .font(.callout)
                .foregroundStyle(.secondary)
        case .wrongVersion:
            VStack(alignment: .leading, spacing: 10) {
                Text("The latest version shown is incorrect.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                TextField("Correct latest version (optional)", text: $feedbackVersion)
                    .textFieldStyle(.roundedBorder)
            }
        case .missingApp:
            VStack(alignment: .leading, spacing: 10) {
                Text("This app is not in the catalog and should be.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                TextField("Homepage URL (optional)", text: $feedbackURL)
                    .textFieldStyle(.roundedBorder)
            }
        }
    }
}

// MARK: - Release Notes Web View

private struct ReleaseNotesWebView: NSViewRepresentable {
    let html: String

    func makeNSView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.preferences.isElementFullscreenEnabled = false
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = context.coordinator
        webView.setValue(false, forKey: "drawsBackground")
        loadHTML(in: webView)
        return webView
    }

    func updateNSView(_ webView: WKWebView, context: Context) {
        loadHTML(in: webView)
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    private func loadHTML(in webView: WKWebView) {
        let wrapped = """
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8">
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, sans-serif;
                font-size: 13px;
                line-height: 1.55;
                color: -apple-system-label;
                margin: 12px;
                word-wrap: break-word;
            }
            h1 { font-size: 1.3em; margin: 0.8em 0 0.4em; }
            h2 { font-size: 1.15em; margin: 0.6em 0 0.3em; }
            h3 { font-size: 1em; margin: 0.4em 0 0.2em; }
            ul, ol { padding-left: 1.5em; margin: 0.4em 0; }
            li { margin: 0.15em 0; }
            p { margin: 0.4em 0; }
            a { color: -apple-system-blue; }
            code {
                font-family: Menlo, monospace;
                font-size: 0.9em;
                background: rgba(128, 128, 128, 0.12);
                padding: 0.15em 0.3em;
                border-radius: 3px;
            }
            pre {
                background: rgba(128, 128, 128, 0.12);
                padding: 8px;
                border-radius: 5px;
                overflow-x: auto;
            }
            pre code { background: none; padding: 0; }
            blockquote {
                border-left: 3px solid rgba(128, 128, 128, 0.3);
                padding-left: 10px;
                margin-left: 0;
                color: rgba(128, 128, 128, 0.8);
            }
            img { max-width: 100%; height: auto; }
            @media (prefers-color-scheme: dark) {
                body { color: #e0e0e0; }
            }
        </style>
        </head>
        <body>\(html)</body>
        </html>
        """
        webView.loadHTMLString(wrapped, baseURL: nil)
    }

    final class Coordinator: NSObject, WKNavigationDelegate {
        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
        ) {
            if navigationAction.navigationType == .linkActivated,
               let url = navigationAction.request.url
            {
                NSWorkspace.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }
    }
}
