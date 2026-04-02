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
}
