import SwiftUI

struct GeneralSettingsTab: View {
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
      set: { selfUpdateService.setAutomaticallyChecksForUpdates($0) }
    )
  }

  private var updateChannelBinding: Binding<SelfUpdateChannel> {
    Binding(
      get: { selfUpdateService.channel },
      set: { selfUpdateService.setChannel($0) }
    )
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
      return
        "Versioneer will check \(feedURL.host ?? "its Sparkle feed") for \(selfUpdateService.channel.feedScopeDescription)."
    }
    return "Sparkle is configured and ready. \(selfUpdateService.channel.statusDescription)"
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

  private var analyticsEnabledBinding: Binding<Bool> {
    Binding(
      get: { appState.settings.analyticsEnabled },
      set: { appState.setAnalyticsEnabled($0) }
    )
  }

  private var crashReportingEnabledBinding: Binding<Bool> {
    Binding(
      get: { appState.settings.crashReportingEnabled },
      set: { appState.setCrashReportingEnabled($0) }
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

        VStack(alignment: .leading, spacing: 8) {
          Text("Update Channel")
            .font(.subheadline.weight(.medium))

          Picker("Update Channel", selection: updateChannelBinding) {
            ForEach(SelfUpdateChannel.allCases) { channel in
              Text(channel.title).tag(channel)
            }
          }
          .pickerStyle(.segmented)
          .labelsHidden()

          Text(selfUpdateService.channel.statusDescription)
            .font(.callout)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
        }

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
            ? "Versioneer checks its Sparkle feed on a schedule, but update installation still requires user approval. Switching from Nightly back to Stable does not reinstall an older build; Versioneer returns to stable once a newer stable release is available."
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

      Section {
        Toggle("Confirm bulk update installs", isOn: $settings.confirmInstallAll)
        Toggle("Confirm admin-required installs", isOn: $settings.confirmPrivilegedInstall)
      } header: {
        Text("Confirmations")
      } footer: {
        Text("Show confirmation prompts before running update actions in these cases.")
      }

      Section {
        Toggle("Analytics collection", isOn: analyticsEnabledBinding)
        Toggle("Crash report collection", isOn: crashReportingEnabledBinding)
      } header: {
        Text("Privacy")
      } footer: {
        Text(
          "Control whether Versioneer reports anonymized analytics and crash reports."
        )
      }
    }
    .formStyle(.grouped)
  }
}
