import Testing

@testable import Versioneer

@MainActor
struct InstallPresentationTests {
  @Test func eligibleInstallUsesStandardPrimaryAction() {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )

    let presentation = InstallPresentation.make(result: result, state: .idle)

    #expect(presentation.primaryActionTitle == "Install Update")
    #expect(presentation.primaryActionDisabled == false)
    #expect(presentation.progress == nil)
  }

  @Test func provisionalInstallShowsWarningCTAAndBanner() {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "OBS Studio",
      bundleId: "com.obsproject.obs-studio",
      decision: .updateAvailable,
      install: DesktopUITestFixtures.provisionalInstall
    )

    let presentation = InstallPresentation.make(result: result, state: .idle)

    #expect(presentation.primaryActionTitle == "Install with Warning")
    #expect(presentation.banners.contains { $0.id == "provisional" })
  }

  @Test func failedHelperApprovalShowsRecoveryAction() {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "TextMate",
      bundleId: "com.macromates.TextMate",
      decision: .updateAvailable,
      install: DesktopUITestFixtures.adminInstall,
      artifact: AppDecision.Artifact(
        id: "pkg",
        downloadUrl: "https://example.com/textmate.pkg",
        architecture: "universal",
        minOsVersion: "14.0",
        artifactType: "pkg",
        sizeBytes: 46_000_000,
        sha256: "pkg_hash",
        expectedTeamId: "TEAM123456",
        expectedBundleId: "com.macromates.TextMate",
        expectedVersionRaw: "2.0"
      )
    )
    let state = DesktopUITestFixtures.operationState(
      appDisplayName: "TextMate",
      phase: .failed,
      detail: "Install failed.",
      errorMessage: "Approve the helper in System Settings.",
      recoveryAction: .openSystemSettings,
      helperStatus: .approvalRequired
    )

    let presentation = InstallPresentation.make(result: result, state: state)

    #expect(presentation.primaryActionTitle == "Retry Install")
    #expect(presentation.recoveryAction == .openSystemSettings)
    #expect(presentation.banners.contains { $0.id == "helper-approval" })
  }

  @Test func verifyingPhaseMapsToExpectedProgressStep() {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )
    let state = DesktopUITestFixtures.operationState(
      appDisplayName: "Firefox",
      phase: .verifying,
      detail: "Checking code signature and notarization…"
    )

    let presentation = InstallPresentation.make(result: result, state: state)

    #expect(presentation.primaryActionDisabled)
    #expect(presentation.statusTitle == "Verifying Download")
    #expect(presentation.progress?.currentStep == 3)
    #expect(presentation.progress?.totalSteps == 5)
    #expect(presentation.progress?.title == "Verifying Download")
  }
}
