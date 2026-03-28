import Foundation

@testable import Versioneer

enum DesktopUITestFixtures {
  static func makeDecision(
    appName: String,
    bundleId: String,
    decision: AppDecision.Decision,
    installedVersion: String = "1.0",
    latestVersion: String = "2.0",
    releasedAt: String? = isoString(daysAgo: 2),
    isVerified: Bool = true,
    installStrategy: InstallStrategy? = .zipReplace,
    artifact: AppDecision.Artifact? = AppDecision.Artifact(
      id: "artifact",
      downloadUrl: "https://example.com/app.zip",
      architecture: "universal",
      minOsVersion: "13.0",
      artifactType: "zip",
      sizeBytes: 50_000_000,
      sha256: "hash"
    )
  ) -> AppDecision {
    AppDecision(
      appName: appName,
      bundleId: bundleId,
      installedVersion: installedVersion,
      matchedAppId: "matched_\(appName.lowercased())",
      matchedAppName: appName,
      matchConfidence: 97,
      decision: decision,
      isVerified: isVerified,
      latestVersion: latestVersion,
      latestVersionRaw: latestVersion,
      latestReleaseId: nil,
      homebrewCaskToken: nil,
      releasedAt: releasedAt,
      staleSince: nil,
      iconUrl: nil,
      artifact: artifact,
      installStrategy: installStrategy
    )
  }

  static func makeInstalledApp(from result: AppDecision) -> InstalledApp {
    InstalledApp(
      name: result.appName,
      bundleId: result.bundleId,
      version: result.installedVersion,
      buildNumber: nil,
      teamId: nil,
      path: "/Applications/\(result.appName).app",
      architecture: result.artifact?.architecture,
      sparkleFeedUrl: nil,
      sparklePublicKey: nil,
      isSparkleApp: false,
      isMasApp: false,
      isElectronApp: false,
      electronUpdateProvider: nil,
      electronUpdateUrl: nil,
      codeSigningAuthority: nil,
      appCategory: nil,
      minMacOSVersion: nil,
      isHomebrewInstalled: false,
      homebrewCaskToken: nil
    )
  }

  static func operationState(
    appDisplayName: String,
    phase: InstallCoordinator.Phase,
    detail: String,
    errorMessage: String? = nil,
    recoveryAction: InstallCoordinator.RecoveryAction? = nil,
    helperStatus: InstallCoordinator.HelperSetupState? = nil
  ) -> InstallCoordinator.OperationState {
    InstallCoordinator.OperationState(
      appDisplayName: appDisplayName,
      phase: phase,
      detail: detail,
      executionId: "exec_test",
      errorMessage: errorMessage,
      installedVersion: nil,
      recoveryAction: recoveryAction,
      helperStatus: helperStatus
    )
  }

  static func isoString(daysAgo: Int) -> String {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime]
    return formatter.string(
      from: Calendar.current.date(byAdding: .day, value: -daysAgo, to: .now) ?? .now)
  }
}
