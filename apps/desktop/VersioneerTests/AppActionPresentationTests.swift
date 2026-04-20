import Foundation
import Testing

@testable import Versioneer

@MainActor
struct AppActionPresentationTests {
  @Test func verifiedDirectInstallUsesInstallAction() {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )

    let presentation = makePresentation(result: result)

    #expect(presentation.kind == .install)
    #expect(presentation.title == "Install Update")
    #expect(presentation.compactTitle == "Update")
    #expect(presentation.systemImage == "arrow.down.circle")
    #expect(presentation.isDisabled == false)
    #expect(presentation.requiresInstallWarning == false)
    #expect(presentation.hasUpdateAction)
  }

  @Test func unverifiedDirectInstallRequiresWarning() {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "OBS Studio",
      bundleId: "com.obsproject.obs-studio",
      decision: .updateAvailable,
      trackingState: .localOnly,
      localReasonCode: .noApprovedSource,
      installStrategy: .dmgCopyReplace
    )

    let presentation = makePresentation(result: result)

    #expect(presentation.kind == .install)
    #expect(presentation.title == "Install with Warning")
    #expect(presentation.requiresInstallWarning)
  }

  @Test func homebrewUpdateUsesHomebrewAction() {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable,
      installStrategy: nil,
      artifact: nil
    )

    let presentation = makePresentation(result: result, isHomebrewInstalled: true)

    #expect(presentation.kind == .brewUpgrade)
    #expect(presentation.title == "Update via Homebrew")
    #expect(presentation.systemImage == "mug.fill")
    #expect(presentation.compactTitle == "Update")
  }

  @Test func macAppStoreUpdateUsesMasAction() {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "Pages",
      bundleId: "com.apple.iWork.Pages",
      decision: .updateAvailable,
      installStrategy: nil,
      artifact: nil
    )

    let presentation = makePresentation(result: result, isMasUpgradeable: true)

    #expect(presentation.kind == .masUpgrade)
    #expect(presentation.title == "Update via Mac App Store")
    #expect(presentation.systemImage == "apple.logo")
    #expect(presentation.compactTitle == "Update")
  }

  @Test func manualFallbackUsesManualAction() throws {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "Mystery Electron",
      bundleId: "com.example.mystery",
      decision: .updateAvailable,
      installStrategy: nil,
      artifact: nil
    )
    let manualAction = ManualUpdateAction(
      title: "Open Download",
      detail: "Download this update in a browser.",
      url: try #require(URL(string: "https://updates.example.com/app.zip"))
    )

    let presentation = makePresentation(result: result, manualUpdateAction: manualAction)

    #expect(presentation.kind == .manualUpdate)
    #expect(presentation.title == "Open Download")
    #expect(presentation.compactTitle == "Open")
    #expect(presentation.systemImage == "arrow.up.forward.app")
    #expect(presentation.hasUpdateAction)
  }

  @Test func ignoredAppUsesStopIgnoringAction() {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )

    let presentation = makePresentation(result: result, isUserIgnored: true)

    #expect(presentation.kind == .stopIgnoring)
    #expect(presentation.title == "Stop Ignoring")
    #expect(presentation.compactTitle == "Unignore")
    #expect(presentation.systemImage == "minus.circle")
    #expect(presentation.isDisabled == false)
  }

  @Test func failedInstallUsesRetryTitleAndUnderlyingRoute() {
    let result = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )
    let installState = operationState(phase: .failed, detail: "Install failed.")

    let presentation = makePresentation(result: result, installState: installState)

    #expect(presentation.kind == .install)
    #expect(presentation.title == "Retry Install")
    #expect(presentation.compactTitle == "Update")
    #expect(presentation.systemImage == "arrow.clockwise")
    #expect(presentation.isDisabled == false)
  }

  @Test func completedAndNonUpdateStatesOpenAppWhenPathExists() {
    let update = DesktopUITestFixtures.makeDecision(
      appName: "Firefox",
      bundleId: "org.mozilla.firefox",
      decision: .updateAvailable
    )
    let completed = operationState(
      phase: .completed,
      detail: "Detected version 2.0.",
      installedVersion: "2.0"
    )
    let completedPresentation = makePresentation(
      result: update,
      installState: completed,
      hasAppPath: true
    )

    #expect(completedPresentation.kind == .openApp)
    #expect(completedPresentation.title == "Open App")
    #expect(completedPresentation.isDisabled == false)

    let upToDate = DesktopUITestFixtures.makeDecision(
      appName: "Stable",
      bundleId: "com.example.stable",
      decision: .upToDate,
      installStrategy: nil,
      artifact: nil
    )
    let missingPathPresentation = makePresentation(result: upToDate, hasAppPath: false)

    #expect(missingPathPresentation.kind == .openApp)
    #expect(missingPathPresentation.title == "Open App")
    #expect(missingPathPresentation.isDisabled)
  }

  private func makePresentation(
    result: AppDecision,
    installState: InstallCoordinator.OperationState = .idle,
    isUserIgnored: Bool = false,
    isHomebrewInstalled: Bool = false,
    isMasUpgradeable: Bool = false,
    hasAppPath: Bool = true,
    manualUpdateAction: ManualUpdateAction? = nil
  ) -> PrimaryAppActionPresentation {
    PrimaryAppActionPresentation.make(
      result: result,
      installState: installState,
      isUserIgnored: isUserIgnored,
      isHomebrewInstalled: isHomebrewInstalled,
      isMasUpgradeable: isMasUpgradeable,
      hasAppPath: hasAppPath,
      manualUpdateAction: manualUpdateAction
    )
  }

  private func operationState(
    phase: InstallCoordinator.Phase,
    detail: String,
    installedVersion: String? = nil
  ) -> InstallCoordinator.OperationState {
    InstallCoordinator.OperationState(
      appDisplayName: "Firefox",
      phase: phase,
      detail: detail,
      executionId: "exec_test",
      errorMessage: phase == .failed ? detail : nil,
      installedVersion: installedVersion,
      recoveryAction: nil,
      helperStatus: nil
    )
  }
}
