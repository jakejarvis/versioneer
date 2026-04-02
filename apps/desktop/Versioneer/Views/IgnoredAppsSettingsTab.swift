import SwiftUI

struct IgnoredAppsSettingsTab: View {
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
          ForEach(appState.ignoredAppRules) { rule in
            IgnoredRuleRow(rule: rule)
          }
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

// MARK: - Ignored Rule Row

private struct IgnoredRuleRow: View {
  @Environment(AppState.self) private var appState

  let rule: IgnoredAppRule

  private var matchedApp: InstalledApp? {
    appState.installedApp(matching: rule)
  }

  private var matchStatusText: String {
    guard let matchedApp else { return "Not currently installed" }
    return "Matches \(matchedApp.name)"
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
}

// MARK: - Add Ignored App Sheet

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
          Button("Cancel") { dismiss() }
        }

        ToolbarItem(placement: .confirmationAction) {
          Button("Add", action: addRule)
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

  // MARK: - Actions

  private func addRule() {
    guard let currentRule else { return }
    appState.addIgnoredAppRule(currentRule)
    dismiss()
  }
}
