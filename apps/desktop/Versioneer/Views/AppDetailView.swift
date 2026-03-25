import SwiftUI

struct AppDetailView: View {
    @Environment(AppState.self) private var appState
    let result: AppDecision

    @State private var showFeedbackSheet = false
    @State private var feedbackType: FeedbackType = .wrongMatch
    @State private var feedbackComment: String = ""
    @State private var feedbackVersion: String = ""
    @State private var feedbackURL: String = ""
    @State private var feedbackSubmitting = false
    @State private var feedbackError: String?
    @State private var feedbackSuccess = false

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
                Divider()
                actionsSection
            }
            .padding(20)
        }
        .navigationTitle(result.matchedAppName ?? result.appName)
        .sheet(isPresented: $showFeedbackSheet) {
            feedbackSheet
        }
        .onChange(of: feedbackSuccess) {
            if feedbackSuccess {
                // Auto-dismiss after success
                DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) {
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

    // MARK: - Actions

    @ViewBuilder
    private var actionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Actions")
                .font(.headline)

            HStack(spacing: 12) {
                Button("Report Issue…") {
                    feedbackComment = ""
                    feedbackVersion = ""
                    feedbackURL = ""
                    feedbackError = nil
                    feedbackSuccess = false
                    showFeedbackSheet = true
                }
            }
        }
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
