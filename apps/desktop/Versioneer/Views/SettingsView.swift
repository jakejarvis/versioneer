import SwiftUI

struct SettingsView: View {
    var body: some View {
        TabView {
            Tab("General", systemImage: "gear") {
                GeneralSettingsTab()
            }
            Tab("Advanced", systemImage: "gearshape.2") {
                AdvancedSettingsTab()
            }
        }
        .scenePadding()
        .frame(width: 450, height: 250)
    }
}

// MARK: - General

private struct GeneralSettingsTab: View {
    @State private var settings = SettingsStore()

    private var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
    }

    private var buildNumber: String {
        Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
    }

    var body: some View {
        Form {
            LabeledContent("Version") {
                Text("\(appVersion) (\(buildNumber))")
                    .foregroundStyle(.secondary)
            }

            Toggle("Scan on launch", isOn: Binding(
                get: { settings.scanOnLaunch },
                set: { settings.scanOnLaunch = $0 }
            ))
        }
    }
}

// MARK: - Advanced

private struct AdvancedSettingsTab: View {
    @State private var settings = SettingsStore()
    @State private var urlString: String = ""

    private var isCustomURL: Bool {
        settings.baseURL != SettingsStore.defaultBaseURL
    }

    var body: some View {
        Form {
            TextField("Server URL", text: $urlString)
                .onSubmit { applyURL() }

            if isCustomURL {
                Button("Reset to Default") {
                    settings.resetBaseURL()
                    urlString = settings.baseURL.absoluteString
                }
                .controlSize(.small)
            }
        }
        .onAppear {
            urlString = settings.baseURL.absoluteString
        }
    }

    private func applyURL() {
        if let url = URL(string: urlString), url.scheme != nil {
            settings.baseURL = url
        }
    }
}
