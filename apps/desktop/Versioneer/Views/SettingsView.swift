import SwiftUI

struct SettingsView: View {
  var body: some View {
    TabView {
      Tab("General", systemImage: "gear") {
        GeneralSettingsTab()
      }
      Tab("Ignored", systemImage: "minus.circle") {
        IgnoredAppsSettingsTab()
      }
      Tab("Advanced", systemImage: "slider.horizontal.3") {
        AdvancedSettingsTab()
      }
    }
    .scenePadding()
    .frame(width: 560, height: 440)
    .versioneerAnalyticsScreen(name: "settings", class: "SettingsView")
  }
}

// MARK: - General

private struct GeneralSettingsTab: View {
  @Environment(AppState.self) private var appState
  @Environment(SelfUpdateService.self) private var selfUpdateService

  private var appVersion: String {
    Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "—"
  }

  private var buildNumber: String {
    Bundle.main.infoDictionary?["CFBundleVersion"] as? String ?? "—"
  }

  private var updateChecksBinding: Binding<Bool> {
    Binding(
      get: { selfUpdateService.automaticallyChecksForUpdates },
      set: { selfUpdateService.setAutomaticallyChecksForUpdates($0) },
    )
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
        Text(
          "Versioneer scans installed apps locally and compares them with the Versioneer catalog.")
      }

      Section {
        HStack(alignment: .top, spacing: 12) {
          StatusChip(
            title: updateStatusTitle,
            tint: updateStatusTint,
            systemImage: updateStatusSymbol
          )

          Text(updateStatusDescription)
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }

        Toggle("Check for updates automatically", isOn: updateChecksBinding)
          .disabled(!selfUpdateService.isAvailable)

        if let lastUpdateCheckDate = selfUpdateService.lastUpdateCheckDate {
          LabeledContent("Last update check") {
            Text(lastUpdateCheckDate, style: .relative)
              .foregroundStyle(.secondary)
          }
        }

        LabeledContent("Update feed") {
          Text(selfUpdateService.feedURL?.absoluteString ?? "Unavailable")
            .font(.callout.monospaced())
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.trailing)
            .textSelection(.enabled)
        }

        Button("Check for Updates…") {
          selfUpdateService.checkForUpdates()
        }
        .disabled(!selfUpdateService.canCheckForUpdates)
      } header: {
        Text("Updates")
      } footer: {
        Text(
          selfUpdateService.isAvailable
            ? "Versioneer checks its Sparkle feed on a schedule, but update installation still requires user approval."
            : "Sparkle self-updates are unavailable until this build is signed with a public Sparkle EdDSA key."
        )
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
        Text(
          "When enabled, Versioneer performs a local scan and update check as soon as the main window opens."
        )
      }
    }
    .formStyle(.grouped)
  }

  private var updateStatusTitle: String {
    if selfUpdateService.isAvailable {
      return selfUpdateService.automaticallyChecksForUpdates
        ? "Automatic Checks On" : "Manual Checks Only"
    }
    return "Unavailable"
  }

  private var updateStatusDescription: String {
    if let configurationIssue = selfUpdateService.configurationIssue {
      return configurationIssue
    }
    if let feedURL = selfUpdateService.feedURL {
      return "Versioneer will check \(feedURL.host ?? "its Sparkle feed") for new stable releases."
    }
    return "Sparkle is configured and ready to check for new stable releases."
  }

  private var updateStatusTint: Color {
    if selfUpdateService.isAvailable {
      return selfUpdateService.automaticallyChecksForUpdates ? .green : .orange
    }
    return .red
  }

  private var updateStatusSymbol: String {
    if selfUpdateService.isAvailable {
      return selfUpdateService.automaticallyChecksForUpdates
        ? "arrow.trianglehead.2.clockwise.circle.fill" : "hand.raised.circle"
    }
    return "xmark.octagon.fill"
  }
}

// MARK: - Ignored Apps

private struct IgnoredAppsSettingsTab: View {
  @Environment(AppState.self) private var appState

  @State private var showAddSheet = false

  var body: some View {
    Form {
      Section {
        HStack(alignment: .top, spacing: 12) {
          StatusChip(
            title: appState.ignoredAppRules.isEmpty
              ? "No Ignored Apps" : "\(appState.ignoredAppRules.count) Ignored",
            tint: appState.ignoredAppRules.isEmpty ? .secondary : .orange,
            systemImage: "minus.circle"
          )

          Text(
            "Ignored apps stay out of the normal result sections and bulk update actions until you remove the rule."
          )
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
        }
      }

      Section {
        HStack {
          Button("Add…") {
            showAddSheet = true
          }

          Spacer()

          if !appState.ignoredAppRules.isEmpty {
            Text(
              "\(appState.ignoredAppRules.count) rule\(appState.ignoredAppRules.count == 1 ? "" : "s")"
            )
            .font(.caption)
            .foregroundStyle(.secondary)
          }
        }

        if appState.ignoredAppRules.isEmpty {
          ContentUnavailableView {
            Label("No Ignored Apps", systemImage: "minus.circle")
          } description: {
            Text("Ignore an app from the main list or add one here.")
          }
        } else {
          List(appState.ignoredAppRules) { rule in
            IgnoredRuleRow(rule: rule)
          }
          .frame(minHeight: 240)
        }
      } header: {
        Text("Ignored Rules")
      } footer: {
        Text(
          "Bundle ID rules survive app moves and reinstalls. Path rules are used for apps without bundle IDs or for manual absolute-path entries."
        )
      }
    }
    .formStyle(.grouped)
    .sheet(isPresented: $showAddSheet) {
      AddIgnoredAppSheet()
    }
  }
}

private struct IgnoredRuleRow: View {
  @Environment(AppState.self) private var appState

  let rule: IgnoredAppRule

  private var matchedApp: InstalledApp? {
    appState.installedApp(matching: rule)
  }

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      VStack(alignment: .leading, spacing: 4) {
        Text(rule.displayName)
          .font(.body.weight(.medium))
          .lineLimit(1)

        Text(rule.detailText)
          .font(.caption.monospacedDigit())
          .foregroundStyle(.secondary)
          .textSelection(.enabled)

        Text(matchStatusText)
          .font(.caption)
          .foregroundStyle(matchedApp == nil ? .tertiary : .secondary)
          .lineLimit(1)
      }

      Spacer(minLength: 12)

      Button("Remove", role: .destructive) {
        appState.removeIgnoredAppRule(rule)
      }
      .buttonStyle(.link)
    }
    .padding(.vertical, 2)
  }

  private var matchStatusText: String {
    guard let matchedApp else { return "Not currently installed" }
    return "Matches \(matchedApp.name)"
  }
}

private struct AddIgnoredAppSheet: View {
  @Environment(AppState.self) private var appState
  @Environment(\.dismiss) private var dismiss

  @State private var mode: AddMode = .installedApps
  @State private var searchText = ""
  @State private var selectedInstalledAppID: String?
  @State private var manualEntry = ""
  @State private var manualDisplayName = ""

  private enum AddMode: String, CaseIterable, Identifiable {
    case installedApps = "Installed Apps"
    case manual = "Manual Entry"

    var id: String { rawValue }
  }

  private var availableInstalledApps: [InstalledApp] {
    let candidates = appState.installedApps
      .filter { !appState.settings.isIgnored($0) }
      .sorted { lhs, rhs in
        lhs.name.localizedStandardCompare(rhs.name) == .orderedAscending
      }

    guard !searchText.isEmpty else { return candidates }
    return candidates.filter { app in
      app.name.localizedCaseInsensitiveContains(searchText)
        || (app.bundleId?.localizedCaseInsensitiveContains(searchText) ?? false)
        || app.path.localizedCaseInsensitiveContains(searchText)
    }
  }

  private var selectedInstalledApp: InstalledApp? {
    availableInstalledApps.first { $0.id == selectedInstalledAppID }
  }

  private var selectedInstalledAppRule: IgnoredAppRule? {
    guard let selectedInstalledApp else { return nil }
    return IgnoredAppRule.make(from: selectedInstalledApp)
  }

  private var manualMatchType: IgnoredAppRule.MatchType {
    IgnoredAppRule.inferredMatchType(for: manualEntry)
  }

  private var manualRule: IgnoredAppRule? {
    IgnoredAppRule.make(
      displayName: manualDisplayName,
      matchType: manualMatchType,
      rawValue: manualEntry
    )
  }

  private var currentRule: IgnoredAppRule? {
    switch mode {
    case .installedApps:
      selectedInstalledAppRule
    case .manual:
      manualRule
    }
  }

  private var currentRuleAlreadyExists: Bool {
    guard let currentRule else { return false }
    return appState.ignoredAppRules.contains { $0.id == currentRule.id }
  }

  private var canAdd: Bool {
    currentRule != nil && !currentRuleAlreadyExists
  }

  var body: some View {
    NavigationStack {
      Form {
        Section {
          Picker("Source", selection: $mode) {
            ForEach(AddMode.allCases) { mode in
              Text(mode.rawValue).tag(mode)
            }
          }
          .pickerStyle(.segmented)
        }

        switch mode {
        case .installedApps:
          installedAppsSection
        case .manual:
          manualEntrySection
        }
      }
      .formStyle(.grouped)
      .navigationTitle("Add Ignored App")
      .toolbar {
        ToolbarItem(placement: .cancellationAction) {
          Button("Cancel") {
            dismiss()
          }
        }

        ToolbarItem(placement: .confirmationAction) {
          Button("Add") {
            guard let currentRule else { return }
            appState.addIgnoredAppRule(currentRule)
            dismiss()
          }
          .disabled(!canAdd)
        }
      }
    }
    .frame(width: 520, height: 420)
  }

  @ViewBuilder
  private var installedAppsSection: some View {
    Section {
      TextField("Search installed apps", text: $searchText)
        .textFieldStyle(.roundedBorder)

      if availableInstalledApps.isEmpty {
        ContentUnavailableView {
          Label("No Matching Apps", systemImage: "app.dashed")
        } description: {
          Text(
            appState.installedApps.isEmpty
              ? "Run a scan first, or use manual entry to add a bundle ID or app path."
              : "No installed apps match the current search or all matching apps are already ignored."
          )
        }
      } else {
        List(selection: $selectedInstalledAppID) {
          ForEach(availableInstalledApps, id: \.id) { app in
            VStack(alignment: .leading, spacing: 2) {
              Text(app.name)
                .font(.body.weight(.medium))
              Text(app.bundleId ?? app.path)
                .font(.caption.monospacedDigit())
                .foregroundStyle(.secondary)
                .lineLimit(1)
            }
            .tag(app.id)
          }
        }
        .frame(minHeight: 220)
      }

      if currentRuleAlreadyExists {
        Label("That rule already exists.", systemImage: "checkmark.circle")
          .foregroundStyle(.secondary)
      }
    } header: {
      Text("Scanned Apps")
    } footer: {
      Text(
        "Selecting an installed app creates a bundle ID rule when possible, otherwise a path rule.")
    }
  }

  private var manualEntrySection: some View {
    Section {
      TextField("Bundle ID or /Applications/App.app", text: $manualEntry)
        .textFieldStyle(.roundedBorder)

      TextField("Display Name (Optional)", text: $manualDisplayName)
        .textFieldStyle(.roundedBorder)

      Label(
        manualMatchType == .path ? "Will save as a path rule." : "Will save as a bundle ID rule.",
        systemImage: manualMatchType == .path ? "folder" : "number"
      )
      .foregroundStyle(.secondary)

      if currentRuleAlreadyExists {
        Label("That rule already exists.", systemImage: "checkmark.circle")
          .foregroundStyle(.secondary)
      }
    } header: {
      Text("Manual Rule")
    } footer: {
      Text(
        "Use a bundle ID for portable matching, or an absolute `.app` path for apps that do not expose a stable bundle identifier."
      )
    }
  }
}

// MARK: - Advanced

private struct AdvancedSettingsTab: View {
  @Environment(AppState.self) private var appState
  @Environment(InstallCoordinator.self) private var installCoordinator

  @State private var urlString = ""
  @State private var newScanRoot = ""

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

  private var helperState: InstallCoordinator.HelperSetupState {
    installCoordinator.helperRegistrationState()
  }

  var body: some View {
    Form {
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
        Text(
          "Use the production API by default. Switch only when pointing the desktop app at a development or staging environment."
        )
      }

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
          Button("Add") {
            appState.settings.addExtraScanRoot(newScanRoot)
            newScanRoot = ""
          }
          .disabled(newScanRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            || !newScanRoot.hasPrefix("/"))
        }
      } header: {
        Text("Extra Scan Directories")
      } footer: {
        Text(
          "/Applications and ~/Applications are always scanned. Add extra absolute paths to scan additional locations."
        )
      }

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
    .formStyle(.grouped)
    .onAppear {
      urlString = appState.settings.baseURL.absoluteString
    }
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

  private func applyURL() {
    guard let parsedURL else { return }
    appState.settings.baseURL = parsedURL
    urlString = parsedURL.absoluteString
  }
}
