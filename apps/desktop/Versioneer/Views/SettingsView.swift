import SwiftUI

struct SettingsView: View {
    @Environment(AppState.self) private var appState

    @State private var urlString: String = ""
    @State private var showSaveConfirmation = false

    var body: some View {
        Form {
            Section("Server") {
                TextField("Backend Base URL", text: $urlString)
                    .textFieldStyle(.roundedBorder)
                    .onAppear {
                        urlString = appState.settings.baseURL.absoluteString
                    }

                HStack {
                    Button("Reset to Default") {
                        appState.settings.resetBaseURL()
                        urlString = appState.settings.baseURL.absoluteString
                    }

                    Spacer()

                    Button("Save") {
                        if let url = URL(string: urlString), url.scheme != nil {
                            appState.settings.baseURL = url
                            showSaveConfirmation = true
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(URL(string: urlString)?.scheme == nil)
                }
            }

            Section("General") {
                Toggle("Scan on launch", isOn: Binding(
                    get: { appState.settings.scanOnLaunch },
                    set: { appState.settings.scanOnLaunch = $0 }
                ))
            }

            Section("About") {
                LabeledContent("Version", value: Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—")
                LabeledContent("Build", value: Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—")

                if let snapshotId = appState.snapshotId {
                    LabeledContent("Last Snapshot", value: snapshotId)
                }
            }
        }
        .formStyle(.grouped)
        .navigationTitle("Settings")
        .overlay(alignment: .bottom) {
            if showSaveConfirmation {
                Text("Settings saved")
                    .font(.callout)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(.regularMaterial, in: Capsule())
                    .transition(.move(edge: .bottom).combined(with: .opacity))
                    .onAppear {
                        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
                            withAnimation { showSaveConfirmation = false }
                        }
                    }
            }
        }
        .animation(.default, value: showSaveConfirmation)
    }
}
