import SwiftUI
import WebKit

struct AppDetailView: View {
    @Environment(AppState.self) private var appState
    @Environment(InstallCoordinator.self) private var installCoordinator
    let result: AppDecision

    @State private var showFeedbackSheet = false
    @State private var showInstallWarning = false
    @State private var feedbackType: FeedbackType = .wrongMatch
    @State private var feedbackComment: String = ""
    @State private var feedbackVersion: String = ""
    @State private var feedbackURL: String = ""
    @State private var feedbackSubmitting = false
    @State private var feedbackError: String?
    @State private var feedbackSuccess = false
    @State private var releaseNotesHtml: String?
    @State private var releaseNotesLoading = false
    @State private var releaseNotesExpanded = true

    enum FeedbackType: String, CaseIterable {
        case wrongMatch = "Wrong Match"
        case wrongVersion = "Wrong Version"
        case missingApp = "Missing App"
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                Divider()
                identitySection
                Divider()
                versionSection
                if result.latestReleaseId != nil {
                    Divider()
                    releaseNotesSection
                }
                Divider()
                actionsSection
            }
            .padding(20)
        }
        .navigationTitle(result.matchedAppName ?? result.appName)
        .task(id: result.latestReleaseId) {
            await loadReleaseNotes()
        }
        .sheet(isPresented: $showFeedbackSheet) {
            feedbackSheet
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
            if feedbackSuccess {
                Task {
                    try? await Task.sleep(for: .seconds(1.5))
                    showFeedbackSheet = false
                    feedbackSuccess = false
                }
            }
        }
    }

    // MARK: - Header

    @ViewBuilder
    private var header: some View {
        HStack(spacing: 16) {
            Image(nsImage: appState.appIcon(for: result))
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: 64, height: 64)

            VStack(alignment: .leading, spacing: 4) {
                Text(result.matchedAppName ?? result.appName)
                    .font(.title)
                    .fontWeight(.bold)

                HStack(spacing: 8) {
                    DecisionBadge(decision: result.decision)
                    Text(VersionFormatting.statusLabel(for: result.decision))
                        .font(.headline)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
            if let confidence = result.matchConfidence {
                VStack {
                    Text(VersionFormatting.confidenceLabel(confidence))
                        .font(.title2)
                        .fontWeight(.semibold)
                    Text("Confidence")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
    }

    // MARK: - Identity

    @ViewBuilder
    private var identitySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Identity")
                .font(.headline)

            LabeledContent("App Name", value: result.appName)
            LabeledContent("Canonical Name", value: result.matchedAppName ?? "—")
            LabeledContent("Bundle ID", value: result.bundleId ?? "—")

            if let matchedId = result.matchedAppId {
                LabeledContent("Matched App ID", value: matchedId)
            }
        }
    }

    // MARK: - Versions

    @ViewBuilder
    private var versionSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Version Info")
                .font(.headline)

            LabeledContent("Installed Version", value: VersionFormatting.displayVersion(result.installedVersion))
            LabeledContent("Latest Version", value: VersionFormatting.displayVersion(result.latestVersion))

            if let raw = result.latestVersionRaw, raw != result.latestVersion {
                LabeledContent("Latest (Raw)", value: raw)
            }

            LabeledContent("Released", value: VersionFormatting.relativeDate(from: result.releasedAt))
        }
    }

    // MARK: - Release Notes

    @ViewBuilder
    private var releaseNotesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Button {
                withAnimation { releaseNotesExpanded.toggle() }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: releaseNotesExpanded ? "chevron.down" : "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    Text("Release Notes")
                        .font(.headline)
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
                } else if let html = releaseNotesHtml, !html.isEmpty {
                    ReleaseNotesWebView(html: html)
                        .frame(minHeight: 100, maxHeight: 400)
                        .clipShape(RoundedRectangle(cornerRadius: 6))
                        .overlay(
                            RoundedRectangle(cornerRadius: 6)
                                .stroke(.separator, lineWidth: 1)
                        )
                } else {
                    Text("No release notes available.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
            }
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

    // MARK: - Actions

    @ViewBuilder
    private var actionsSection: some View {
        let installState = installCoordinator.state(for: result)

        VStack(alignment: .leading, spacing: 12) {
            Text("Actions")
                .font(.headline)

            HStack(spacing: 12) {
                if result.install.canInstall {
                    Button {
                        if result.install.eligibility == .requiresWarning {
                            showInstallWarning = true
                        } else {
                            Task { await appState.install(result) }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            if installState.isRunning {
                                ProgressView()
                                    .controlSize(.small)
                            }
                            Text(primaryInstallButtonTitle(for: installState))
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(installState.isRunning)
                }

                Button("Report Issue…") {
                    feedbackComment = ""
                    feedbackVersion = ""
                    feedbackURL = ""
                    feedbackError = nil
                    feedbackSuccess = false
                    showFeedbackSheet = true
                }
            }

            if let installInfo = installSummary(installState: installState) {
                Text(installInfo)
                    .font(.callout)
                    .foregroundStyle(installState.phase == .failed ? .red : .secondary)
            }

            if !result.install.canInstall {
                Text(unavailableInstallReason)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            } else {
                Text(installSupportSummary)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func primaryInstallButtonTitle(for state: InstallCoordinator.OperationState) -> String {
        switch state.phase {
        case .downloading: "Downloading…"
        case .verifying: "Verifying…"
        case .installing: "Installing…"
        case .relaunching: "Relaunching…"
        case .failed: "Retry Install"
        default:
            result.install.eligibility == .requiresWarning ? "Install with Warning…" : "Install Update"
        }
    }

    private func installSummary(installState: InstallCoordinator.OperationState) -> String? {
        switch installState.phase {
        case .idle:
            return nil
        case .completed:
            if let version = installState.installedVersion {
                return "Install completed. Detected version \(version)."
            }
            return "Install completed."
        case .failed:
            return installState.errorMessage ?? "Install failed."
        default:
            return installState.detail
        }
    }

    private var unavailableInstallReason: String {
        switch result.install.eligibility {
        case .masApp:
            "Mac App Store apps must be updated through the App Store."
        case .manualOnly:
            "This app is currently configured for manual updates only."
        case .requiresWarning, .eligible:
            ""
        case .notSupported:
            "Versioneer does not currently have an install path for this update."
        }
    }

    private var installSupportSummary: String {
        var parts: [String] = []
        if let strategy = result.install.strategy {
            parts.append("Strategy: \(strategy.rawValue)")
        }
        if result.install.requiresAdmin {
            parts.append("Admin authentication may be required")
        }
        if result.install.requiresQuit {
            parts.append("The app will need to quit first")
        }
        if let artifact = result.artifact,
           let sizeBytes = artifact.sizeBytes {
            let formatter = ByteCountFormatter()
            formatter.countStyle = .file
            parts.append("Download: \(formatter.string(fromByteCount: Int64(sizeBytes)))")
        }
        return parts.joined(separator: " • ")
    }

    // MARK: - Feedback Sheet

    @ViewBuilder
    private var feedbackSheet: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Report Issue")
                .font(.title2)
                .fontWeight(.bold)

            Picker("Issue Type", selection: $feedbackType) {
                ForEach(FeedbackType.allCases, id: \.self) { type in
                    Text(type.rawValue).tag(type)
                }
            }
            .pickerStyle(.segmented)

            switch feedbackType {
            case .wrongMatch:
                Text("This app was matched to the wrong catalog entry.")
                    .font(.callout)
                    .foregroundStyle(.secondary)

            case .wrongVersion:
                Text("The latest version shown is incorrect.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                TextField("Correct latest version (optional)", text: $feedbackVersion)
                    .textFieldStyle(.roundedBorder)

            case .missingApp:
                Text("This app is not in the catalog and should be.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                TextField("Homepage URL (optional)", text: $feedbackURL)
                    .textFieldStyle(.roundedBorder)
            }

            TextField("Additional comments (optional)", text: $feedbackComment, axis: .vertical)
                .textFieldStyle(.roundedBorder)
                .lineLimit(3...6)

            if let error = feedbackError {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.red)
            }

            if feedbackSuccess {
                Label("Feedback submitted!", systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.green)
            }

            HStack {
                Spacer()
                Button("Cancel") {
                    showFeedbackSheet = false
                }
                .keyboardShortcut(.cancelAction)

                Button("Submit") {
                    Task { await submitFeedback() }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(feedbackSubmitting)
            }
        }
        .padding(20)
        .frame(minWidth: 400)
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

// MARK: - Release Notes Web View

private struct ReleaseNotesWebView: NSViewRepresentable {
    let html: String

    func makeNSView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.isElementFullscreenEnabled = false
        let webView = WKWebView(frame: .zero, configuration: config)
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
                line-height: 1.5;
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
            // Open external links in the default browser
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
