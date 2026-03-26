import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            Tab("General", systemImage: "gear") {
                GeneralSettingsTab()
            }
            Tab("Advanced", systemImage: "slider.horizontal.3") {
                AdvancedSettingsTab()
            }
        }
        .scenePadding()
        .frame(width: 520, height: 360)
    }
}

// MARK: - General

private struct GeneralSettingsTab: View {
    @Environment(AppState.self) private var appState

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
    }

    var body: some View {
        @Bindable var settings = appState.settings

        Form {
            Section {
                LabeledContent("Version") {
                    Text("\(appVersion) (\(buildNumber))")
                        .foregroundStyle(.secondary)
                }
            } footer: {
                Text("Versioneer scans installed apps locally and compares them with the Versioneer catalog.")
            }

            Section {
                Toggle("Scan on launch", isOn: $settings.scanOnLaunch)

                if let lastCompletedAt = appState.scanSummary.lastCompletedAt {
                    LabeledContent("Last completed scan") {
                        Text(lastCompletedAt, style: .relative)
                            .foregroundStyle(.secondary)
                    }
                }
            } header: {
                Text("Scanning")
            } footer: {
                Text("When enabled, Versioneer performs a local scan and update check as soon as the main window opens.")
            }
        }
        .formStyle(.grouped)
    }
}

// MARK: - Advanced

private struct AdvancedSettingsTab: View {
    @Environment(AppState.self) private var appState
    @Environment(InstallCoordinator.self) private var installCoordinator

    @State private var urlString = ""

    private var trimmedURLString: String {
        urlString.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var parsedURL: URL? {
        guard let url = URL(string: trimmedURLString),
              let scheme = url.scheme,
              ["http", "https"].contains(scheme),
              url.host != nil else {
            return nil
        }
        return url
    }

    private var hasPendingChange: Bool {
        trimmedURLString != appState.settings.baseURL.absoluteString
    }

    private var canApplyURL: Bool {
        parsedURL != nil && hasPendingChange
    }

    private var helperState: InstallCoordinator.HelperSetupState {
        installCoordinator.helperRegistrationState()
    }

    var body: some View {
        Form {
            Section {
                TextField("Server URL", text: $urlString)
                    .textFieldStyle(.roundedBorder)

                if hasPendingChange {
                    Label(
                        parsedURL == nil
                            ? "Enter a valid http or https URL."
                            : "This change affects future catalog and install requests.",
                        systemImage: parsedURL == nil ? "exclamationmark.triangle.fill" : "arrow.clockwise"
                    )
                    .foregroundStyle(parsedURL == nil ? .orange : .secondary)
                }

                HStack {
                    Button("Apply") {
                        applyURL()
                    }
                    .disabled(!canApplyURL)

                    Button("Reset to Default") {
                        appState.settings.resetBaseURL()
                        urlString = appState.settings.baseURL.absoluteString
                    }
                    .disabled(appState.settings.baseURL == SettingsStore.defaultBaseURL)
                }
            } header: {
                Text("Server")
            } footer: {
                Text("Use the production API by default. Switch only when pointing the desktop app at a development or staging environment.")
            }

            Section {
                HStack(alignment: .top, spacing: 12) {
                    VersioneerStatusChip(
                        title: helperStateTitle,
                        tint: helperTint,
                        systemImage: helperSymbol
                    )

                    Text(helperDescription)
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if helperState == .approvalRequired {
                    Button("Open System Settings") {
                        installCoordinator.performRecoveryAction(.openSystemSettings)
                    }
                }
            } header: {
                Text("Privileged Helper")
            } footer: {
                Text("Versioneer uses its privileged helper only for updates that require administrator access, such as writing into protected app locations or installing signed packages.")
            }
        }
        .formStyle(.grouped)
        .onAppear {
            urlString = appState.settings.baseURL.absoluteString
        }
    }

    private var helperStateTitle: String {
        switch helperState {
        case .notNeeded:
            "Ready on Demand"
        case .notRegistered:
            "Ready on Demand"
        case .preparing:
            "Preparing"
        case .ready:
            "Enabled"
        case .approvalRequired:
            "Approval Required"
        case .unavailable:
            "Unavailable"
        case .failed:
            "Failed"
        }
    }

    private var helperDescription: String {
        switch helperState {
        case .notNeeded, .notRegistered:
            "The helper has not been registered yet. Versioneer will register it automatically the first time an admin-required update is needed."
        case .preparing:
            "Versioneer is preparing the helper for an admin-required update."
        case .ready:
            "The helper is installed and ready to handle admin-required update steps."
        case .approvalRequired:
            "Approve the helper in System Settings before retrying the next admin-required install."
        case .unavailable:
            "Versioneer could not find or register its bundled privileged helper."
        case .failed:
            "The helper encountered an error the last time Versioneer tried to use it."
        }
    }

    private var helperTint: Color {
        switch helperState {
        case .ready:
            .green
        case .approvalRequired:
            .orange
        case .unavailable, .failed:
            .red
        case .preparing:
            .accentColor
        case .notNeeded, .notRegistered:
            .secondary
        }
    }

    private var helperSymbol: String {
        switch helperState {
        case .ready:
            "checkmark.circle.fill"
        case .approvalRequired:
            "lock.trianglebadge.exclamationmark"
        case .unavailable, .failed:
            "xmark.octagon.fill"
        case .preparing:
            "arrow.trianglehead.2.clockwise"
        case .notNeeded, .notRegistered:
            "wrench.and.screwdriver"
        }
    }

    private func applyURL() {
        guard let parsedURL else { return }
        appState.settings.baseURL = parsedURL
        urlString = parsedURL.absoluteString
    }
}
