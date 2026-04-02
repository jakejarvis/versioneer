import SwiftUI

struct AdvancedSettingsTab: View {
  var body: some View {
    Form {
      ServerSettingsSection()
      ScanDirectoriesSection()
      MasCliSection()
      HelperSection()
    }
    .formStyle(.grouped)
  }
}

// MARK: - Server

private struct ServerSettingsSection: View {
  @Environment(AppState.self) private var appState

  @State private var urlString = ""

  private var trimmedURLString: String {
    urlString.trimmingCharacters(in: .whitespacesAndNewlines)
  }

  private var parsedURL: URL? {
    guard let url = URL(string: trimmedURLString),
      let scheme = url.scheme,
      ["http", "https"].contains(scheme),
      url.host != nil
    else {
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

  var body: some View {
    Section {
      TextField("Server URL", text: $urlString)
        .font(.body.monospaced())
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
        Button("Apply", action: applyURL)
          .disabled(!canApplyURL)

        Button("Reset to Default", action: resetURL)
          .disabled(appState.settings.baseURL == SettingsStore.defaultBaseURL)
      }
    } header: {
      Text("Server")
    } footer: {
      Text(
        "Use the production API by default. Switch only when pointing the desktop app at a development or staging environment."
      )
    }
    .onAppear {
      urlString = appState.settings.baseURL.absoluteString
    }
  }

  // MARK: - Actions

  private func applyURL() {
    guard let parsedURL else { return }
    appState.settings.baseURL = parsedURL
    urlString = parsedURL.absoluteString
  }

  private func resetURL() {
    appState.settings.resetBaseURL()
    urlString = appState.settings.baseURL.absoluteString
  }
}

// MARK: - Scan Directories

private struct ScanDirectoriesSection: View {
  @Environment(AppState.self) private var appState

  @State private var newScanRoot = ""

  private var canAddRoot: Bool {
    !newScanRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
      && newScanRoot.hasPrefix("/")
  }

  var body: some View {
    Section {
      if appState.settings.extraScanRoots.isEmpty {
        Text("No extra directories configured.")
          .foregroundStyle(.secondary)
      } else {
        ForEach(appState.settings.extraScanRoots, id: \.self) { root in
          HStack {
            Text(root)
              .font(.body.monospaced())
              .lineLimit(1)
              .truncationMode(.middle)
            Spacer()
            Button("Remove", role: .destructive) {
              appState.settings.removeExtraScanRoot(root)
            }
            .buttonStyle(.link)
          }
        }
      }

      HStack {
        TextField("/path/to/directory", text: $newScanRoot)
          .font(.body.monospaced())
          .textFieldStyle(.roundedBorder)
        Button("Add", action: addScanRoot)
          .disabled(!canAddRoot)
      }
    } header: {
      Text("Extra Scan Directories")
    } footer: {
      Text(
        "/Applications and ~/Applications are always scanned. Add extra absolute paths to scan additional locations."
      )
    }
  }

  private func addScanRoot() {
    appState.settings.addExtraScanRoot(newScanRoot)
    newScanRoot = ""
  }
}

// MARK: - Mac App Store CLI

private struct MasCliSection: View {
  @Environment(AppState.self) private var appState

  @State private var masPathOverride = ""

  private var masStatusTitle: String {
    if appState.settings.masCliPathOverride != nil {
      return "Custom Path"
    }
    return appState.settings.isMasCliAvailable ? "Detected" : "Not Found"
  }

  private var masStatusTint: Color {
    appState.settings.isMasCliAvailable ? .green : .secondary
  }

  private var masStatusSymbol: String {
    appState.settings.isMasCliAvailable ? "checkmark.circle.fill" : "magnifyingglass"
  }

  private var masStatusDescription: String {
    if appState.settings.isMasCliAvailable {
      return
        "mas-cli is available. Versioneer will offer automatic upgrades for Mac App Store apps."
    }
    return
      "mas-cli was not found. Install it with `brew install mas` to enable automatic Mac App Store upgrades."
  }

  private var canApplyMasPath: Bool {
    let trimmed = masPathOverride.trimmingCharacters(in: .whitespacesAndNewlines)
    return !trimmed.isEmpty && masPathOverride != (appState.settings.masCliPathOverride ?? "")
  }

  var body: some View {
    Section {
      HStack(alignment: .top, spacing: 12) {
        StatusChip(
          title: masStatusTitle,
          tint: masStatusTint,
          systemImage: masStatusSymbol
        )

        Text(masStatusDescription)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      if let detectedPath = appState.settings.resolvedMasCliPath,
        appState.settings.masCliPathOverride == nil
      {
        LabeledContent("Detected Path") {
          Text(detectedPath)
            .font(.body.monospaced())
            .foregroundStyle(.secondary)
            .textSelection(.enabled)
        }
      }

      HStack {
        TextField("Custom mas path (optional)", text: $masPathOverride)
          .font(.body.monospaced())
          .textFieldStyle(.roundedBorder)
        Button("Apply", action: applyMasPath)
          .disabled(!canApplyMasPath)
        Button("Clear", action: clearMasPath)
          .disabled(appState.settings.masCliPathOverride == nil)
      }

      if !masPathOverride.isEmpty,
        !FileManager.default.isExecutableFile(
          atPath: masPathOverride.trimmingCharacters(in: .whitespacesAndNewlines))
      {
        Label("No executable found at this path.", systemImage: "exclamationmark.triangle.fill")
          .foregroundStyle(.orange)
      }
    } header: {
      Text("Mac App Store CLI (mas)")
    } footer: {
      Text(
        "When mas-cli is available, Versioneer can upgrade Mac App Store apps automatically instead of opening the App Store. Install via: brew install mas"
      )
    }
    .onAppear {
      masPathOverride = appState.settings.masCliPathOverride ?? ""
    }
  }

  // MARK: - Actions

  private func applyMasPath() {
    let trimmed = masPathOverride.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return }
    appState.settings.masCliPathOverride = trimmed
    masPathOverride = trimmed
  }

  private func clearMasPath() {
    appState.settings.masCliPathOverride = nil
    masPathOverride = ""
  }
}

// MARK: - Privileged Helper

private struct HelperSection: View {
  @Environment(InstallCoordinator.self) private var installCoordinator

  private var helperState: InstallCoordinator.HelperSetupState {
    installCoordinator.helperRegistrationState()
  }

  private var helperStateTitle: String {
    switch helperState {
    case .notNeeded: "Ready on Demand"
    case .notRegistered: "Ready on Demand"
    case .preparing: "Preparing"
    case .ready: "Enabled"
    case .approvalRequired: "Approval Required"
    case .unavailable: "Unavailable"
    case .failed: "Failed"
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
    case .ready: .green
    case .approvalRequired: .orange
    case .unavailable, .failed: .red
    case .preparing: .accentColor
    case .notNeeded, .notRegistered: .secondary
    }
  }

  private var helperSymbol: String {
    switch helperState {
    case .ready: "checkmark.circle.fill"
    case .approvalRequired: "lock.trianglebadge.exclamationmark"
    case .unavailable, .failed: "xmark.octagon.fill"
    case .preparing: "arrow.trianglehead.2.clockwise"
    case .notNeeded, .notRegistered: "wrench.and.screwdriver"
    }
  }

  var body: some View {
    Section {
      HStack(alignment: .top, spacing: 12) {
        StatusChip(
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
      Text(
        "Versioneer uses its privileged helper only for updates that require administrator access, such as writing into protected app locations or installing signed packages."
      )
    }
  }
}
