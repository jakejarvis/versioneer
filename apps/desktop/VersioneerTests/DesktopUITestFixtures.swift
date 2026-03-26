import Foundation
@testable import Versioneer

enum DesktopUITestFixtures {
    static let eligibleInstall = AppDecision.Install(
        canInstall: true,
        installabilityClass: .assistedReplace,
        strategy: .zipReplace,
        requiresQuit: true,
        requiresAdmin: false,
        supportsSilent: false,
        eligibility: .eligible
    )

    static let provisionalInstall = AppDecision.Install(
        canInstall: true,
        installabilityClass: .assistedReplace,
        strategy: .dmgCopyReplace,
        requiresQuit: true,
        requiresAdmin: false,
        supportsSilent: false,
        eligibility: .requiresWarning
    )

    static let adminInstall = AppDecision.Install(
        canInstall: true,
        installabilityClass: .automationCandidate,
        strategy: .pkgInstall,
        requiresQuit: true,
        requiresAdmin: true,
        supportsSilent: true,
        eligibility: .eligible
    )

    static func makeDecision(
        appName: String,
        bundleId: String,
        decision: AppDecision.Decision,
        installedVersion: String = "1.0",
        latestVersion: String = "2.0",
        releasedAt: String? = isoString(daysAgo: 2),
        install: AppDecision.Install = eligibleInstall,
        artifact: AppDecision.Artifact? = AppDecision.Artifact(
            id: "artifact",
            downloadUrl: "https://example.com/app.zip",
            architecture: "universal",
            minOsVersion: "13.0",
            artifactType: "zip",
            sizeBytes: 50_000_000,
            sha256: "hash",
            expectedTeamId: "TEAM123456",
            expectedBundleId: "com.example.app",
            expectedVersionRaw: "2.0"
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
            latestVersion: latestVersion,
            latestVersionRaw: latestVersion,
            latestReleaseId: nil,
            releasedAt: releasedAt,
            artifact: artifact,
            install: install
        )
    }

    static func makeInstalledApp(from result: AppDecision) -> InstalledApp {
        InstalledApp(
            name: result.appName,
            bundleId: result.bundleId,
            version: result.installedVersion,
            buildNumber: nil,
            teamId: result.artifact?.expectedTeamId,
            path: "/Applications/\(result.appName).app",
            architecture: result.artifact?.architecture,
            sparkleFeedUrl: nil,
            sparklePublicKey: nil,
            isSparkleApp: false,
            isMasApp: false,
            isElectronApp: false,
            electronUpdateProvider: nil,
            electronUpdateUrl: nil
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
        return formatter.string(from: Calendar.current.date(byAdding: .day, value: -daysAgo, to: .now) ?? .now)
    }
}
