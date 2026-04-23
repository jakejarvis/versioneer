import AppKit
import Foundation
import Logging
import Observation
import Sparkle

@Observable
@MainActor
final class InstallCoordinator {
  nonisolated enum HelperSetupState: String, Sendable {
    case notNeeded
    case notRegistered
    case preparing
    case ready
    case approvalRequired
    case unavailable
    case failed
  }

  nonisolated enum RecoveryAction: Equatable, Sendable {
    case openSystemSettings
  }

  nonisolated enum ExecutionRoute: String, Equatable, Sendable {
    case sparkle = "sparkle"
    case localReplace = "local_replace"
    case privilegedReplace = "privileged_replace"
    case privilegedPackage = "privileged_package"
    case brewUpgrade = "brew_upgrade"
    case masUpgrade = "mas_upgrade"
  }

  nonisolated enum Phase: String, Sendable {
    case idle
    case preparing
    case downloading
    case verifying
    case installing
    case relaunching
    case completed
    case failed
  }

  nonisolated struct OperationState: Equatable, Sendable {
    let appDisplayName: String?
    let phase: Phase
    let detail: String
    let executionId: String?
    let errorMessage: String?
    let installedVersion: String?
    let recoveryAction: RecoveryAction?
    let helperStatus: HelperSetupState?

    var isRunning: Bool {
      switch phase {
      case .preparing, .downloading, .verifying, .installing, .relaunching:
        true
      default:
        false
      }
    }

    static let idle = OperationState(
      appDisplayName: nil,
      phase: .idle,
      detail: "",
      executionId: nil,
      errorMessage: nil,
      installedVersion: nil,
      recoveryAction: nil,
      helperStatus: nil
    )
  }

  private var operations: [String: OperationState] = [:]
  let privilegedHelperClient: any PrivilegedHelperClientProtocol

  /// Called when any operation state changes, allowing observers to rebuild derived state.
  var onStateChange: (() -> Void)?

  init(privilegedHelperClient: any PrivilegedHelperClientProtocol = PrivilegedHelperClient()) {
    self.privilegedHelperClient = privilegedHelperClient
  }

  func state(for result: AppDecision) -> OperationState {
    operations[result.id] ?? .idle
  }

  var primaryOperationState: OperationState? {
    operations.values
      .filter { $0.phase != .idle }
      .sorted { lhs, rhs in
        relevancePriority(for: lhs) < relevancePriority(for: rhs)
      }
      .first
  }

  func helperRegistrationState() -> HelperSetupState {
    switch privilegedHelperClient.registrationStatus() {
    case .enabled:
      .ready
    case .notRegistered:
      .notRegistered
    case .requiresApproval:
      .approvalRequired
    case .notFound:
      .unavailable
    }
  }

  @discardableResult
  func startInstall(
    result: AppDecision,
    installedApp: InstalledApp,
    apiClient: InventoryAPIClient
  ) async -> Bool {
    guard result.canInstall else { return false }
    if state(for: result).isRunning { return false }

    let operationKey = result.id
    let appDisplayName = result.matchedAppName ?? result.appName
    var verificationSummary = InstallVerificationSummary(
      strategy: result.installStrategy?.rawValue ?? InstallStrategy.manualOnly.rawValue,
      executionRoute: nil
    )
    var stagedDirectory: URL?
    var usedPrivilegedHelper = false
    var plan: InstallPlan?
    var executionId: String?
    var executionRouteUsed: ExecutionRoute?

    do {
      updateState(
        for: operationKey,
        appDisplayName: appDisplayName,
        phase: .preparing,
        detail: "Preparing install…",
        executionId: nil,
        errorMessage: nil,
        installedVersion: nil,
        recoveryAction: nil,
        helperStatus: .notNeeded
      )

      guard let installPlan = InstallPlan(result: result, installedApp: installedApp) else {
        throw InstallError.unsupportedStrategy
      }
      try validateCatalogInstallTrust(plan: installPlan, installedApp: installedApp)
      plan = installPlan

      executionRouteUsed =
        switch installPlan.strategy {
        case .sparkle:
          .sparkle
        case .zipReplace, .dmgCopyReplace:
          executionRoute(
            for: installPlan, destinationAppURL: URL(fileURLWithPath: installedApp.path))
        case .pkgInstall:
          .privilegedPackage
        case .macAppStore, .manualOnly:
          nil
        }
      verificationSummary.executionRoute = executionRouteUsed?.rawValue

      if let route = executionRouteUsed, installPlan.isCatalogBacked {
        do {
          let prepared = try await apiClient.prepareInstallExecution(
            plan: installPlan,
            installedApp: installedApp,
            executionRoute: route
          )
          executionId = prepared.execution.id
        } catch {
          executionId = installPlan.localId
          Logger.api.error(
            "Failed to prepare install execution for \(installedApp.name): \(error.localizedDescription)"
          )
          PostHogTelemetry.captureException(
            error,
            properties: telemetryProperties(
              for: result,
              route: route.rawValue,
              operation: "prepare_install_execution"
            )
          )
        }
      } else {
        executionId = installPlan.localId
      }

      let activeExecutionId = executionId ?? installPlan.localId
      stagedDirectory = try makeStagingDirectory(executionId: activeExecutionId)

      switch installPlan.strategy {
      case .sparkle:
        updateState(
          for: operationKey,
          phase: .installing,
          detail: "Running the app's Sparkle updater…",
          executionId: activeExecutionId,
          errorMessage: nil,
          installedVersion: nil,
          recoveryAction: nil,
          helperStatus: .notNeeded
        )
        try await ExternalSparkleInstaller().install(appAt: URL(fileURLWithPath: installedApp.path))
        verificationSummary = InstallVerificationSummary(
          strategy: installPlan.strategy.rawValue,
          executionRoute: executionRouteUsed?.rawValue
        )

      case .zipReplace, .dmgCopyReplace:
        guard let stagingDir = stagedDirectory else { throw InstallError.missingStagingDirectory }
        let artifactURL = try await downloadArtifact(
          artifact: installPlan.artifact, strategy: installPlan.strategy, to: stagingDir)
        let preparedBundle = try await prepareAppBundle(
          strategy: installPlan.strategy,
          artifactURL: artifactURL,
          stagingDirectory: stagingDir
        )
        defer {
          if let mountedVolumeURL = preparedBundle.mountedVolumeURL {
            Task {
              try? await self.unmountDiskImage(at: mountedVolumeURL)
            }
          }
        }

        updateState(
          for: operationKey,
          phase: .verifying,
          detail: "Verifying downloaded app…",
          executionId: activeExecutionId,
          errorMessage: nil,
          installedVersion: nil,
          recoveryAction: nil,
          helperStatus: .notNeeded
        )
        verificationSummary = try await verifyAppBundle(
          bundleURL: preparedBundle.appBundleURL,
          downloadedArtifactURL: artifactURL,
          expectedHash: installPlan.artifact?.sha256,
          targetArchitecture: installPlan.targetArchitecture ?? Self.systemArchitecture(),
          installedApp: installedApp,
          strategy: installPlan.strategy,
          executionRoute: executionRouteUsed
        )

        try await ensureTargetAppIsClosed(installedApp: installedApp)

        let destinationAppURL = URL(fileURLWithPath: installedApp.path)
        guard let route = executionRouteUsed else { throw InstallError.unsupportedStrategy }
        switch route {
        case .localReplace:
          updateState(
            for: operationKey,
            phase: .installing,
            detail: "Replacing installed app…",
            executionId: activeExecutionId,
            errorMessage: nil,
            installedVersion: nil,
            recoveryAction: nil,
            helperStatus: .notNeeded
          )
          try await replaceInstalledAppLocally(
            sourceAppURL: preparedBundle.appBundleURL,
            destinationAppURL: destinationAppURL,
            stagingDirectory: stagingDir
          )

        case .privilegedReplace:
          usedPrivilegedHelper = true
          updateState(
            for: operationKey,
            phase: .installing,
            detail: "Setting up privileged installer…",
            executionId: activeExecutionId,
            errorMessage: nil,
            installedVersion: nil,
            recoveryAction: nil,
            helperStatus: .preparing
          )
          try await replaceInstalledAppViaHelper(
            executionId: activeExecutionId,
            sourceAppURL: preparedBundle.appBundleURL,
            destinationAppURL: destinationAppURL,
            stagingDirectory: stagingDir
          )

        case .sparkle, .privilegedPackage, .brewUpgrade, .masUpgrade:
          throw InstallError.unsupportedStrategy
        }

        if installPlan.strategy.requiresQuit {
          updateState(
            for: operationKey,
            phase: .relaunching,
            detail: "Relaunching app…",
            executionId: activeExecutionId,
            errorMessage: nil,
            installedVersion: nil,
            recoveryAction: nil,
            helperStatus: usedPrivilegedHelper ? .ready : .notNeeded
          )
          try await relaunchApp(at: URL(fileURLWithPath: installedApp.path))
        }

      case .pkgInstall:
        guard let stagingDir = stagedDirectory else { throw InstallError.missingStagingDirectory }
        let artifactURL = try await downloadArtifact(
          artifact: installPlan.artifact, strategy: installPlan.strategy, to: stagingDir)

        updateState(
          for: operationKey,
          phase: .verifying,
          detail: "Verifying package…",
          executionId: activeExecutionId,
          errorMessage: nil,
          installedVersion: nil,
          recoveryAction: nil,
          helperStatus: .notNeeded
        )
        verificationSummary = try await verifyPackage(
          packageURL: artifactURL,
          expectedHash: installPlan.artifact?.sha256,
          installedApp: installedApp,
          strategy: installPlan.strategy,
          executionRoute: executionRouteUsed
        )

        usedPrivilegedHelper = true
        updateState(
          for: operationKey,
          phase: .installing,
          detail: "Setting up privileged installer…",
          executionId: activeExecutionId,
          errorMessage: nil,
          installedVersion: nil,
          recoveryAction: nil,
          helperStatus: .preparing
        )
        try await installPackageViaHelper(
          executionId: activeExecutionId,
          packageURL: artifactURL,
          stagingDirectory: stagingDir
        )

      case .macAppStore:
        if let urlString = installPlan.artifact?.downloadUrl,
          let url = URL(string: urlString)
        {
          NSWorkspace.shared.open(url)
        }
        verificationSummary = InstallVerificationSummary(
          strategy: installPlan.strategy.rawValue,
          executionRoute: nil
        )

      case .manualOnly:
        throw InstallError.unsupportedStrategy
      }

      let installedVersion = readInstalledVersion(at: URL(fileURLWithPath: installedApp.path))
      if let installedVersion, let expectedVersion = result.latestVersionRaw ?? result.latestVersion
      {
        verificationSummary.versionMatch = installedVersion == expectedVersion
      }

      updateState(
        for: operationKey,
        phase: .completed,
        detail: "Install completed.",
        executionId: activeExecutionId,
        errorMessage: nil,
        installedVersion: installedVersion,
        recoveryAction: nil,
        helperStatus: usedPrivilegedHelper ? .ready : .notNeeded
      )
      if let installPlan = plan, installPlan.isCatalogBacked, let route = executionRouteUsed {
        await reportInstallExecution(
          apiClient: apiClient,
          executionId: activeExecutionId,
          plan: installPlan,
          installedApp: installedApp,
          executionRoute: route,
          status: "succeeded",
          installedVersion: installedVersion,
          errorMessage: nil,
          verification: verificationSummary
        )
      }
      PostHogTelemetry.capture(
        "desktop_install_completed",
        properties: telemetryProperties(
          for: result,
          route: executionRouteUsed?.rawValue,
          operation: "install",
          status: "succeeded",
          used_privileged_helper: usedPrivilegedHelper
        )
      )
      cleanupStagingDirectory(stagedDirectory)
      return true
    } catch {
      Logger.install.error("Install failed for \(installedApp.name): \(error.localizedDescription)")
      PostHogTelemetry.captureException(
        error,
        properties: telemetryProperties(
          for: result,
          route: executionRouteUsed?.rawValue,
          operation: "install"
        )
      )

      updateState(
        for: operationKey,
        phase: .failed,
        detail: "Install failed.",
        executionId: nil,
        errorMessage: error.localizedDescription,
        installedVersion: nil,
        recoveryAction: recoveryAction(for: error),
        helperStatus: helperSetupState(for: error) ?? (usedPrivilegedHelper ? .failed : .notNeeded)
      )
      if let installPlan = plan, installPlan.isCatalogBacked, let route = executionRouteUsed {
        let reportExecutionId = executionId ?? installPlan.localId
        await reportInstallExecution(
          apiClient: apiClient,
          executionId: reportExecutionId,
          plan: installPlan,
          installedApp: installedApp,
          executionRoute: route,
          status: installStatusString(for: error),
          installedVersion: nil,
          errorMessage: error.localizedDescription,
          verification: verificationSummary
        )
      }
      PostHogTelemetry.capture(
        "desktop_install_failed",
        properties: telemetryProperties(
          for: result,
          route: executionRouteUsed?.rawValue,
          operation: "install",
          status: installStatusString(for: error),
          used_privileged_helper: usedPrivilegedHelper
        )
      )
      cleanupStagingDirectory(stagedDirectory)
      return false
    }
  }

  private func installStatusString(for error: Error) -> String {
    if let installError = error as? InstallError {
      switch installError {
      case .cancelled:
        return "cancelled"
      default:
        break
      }
    }
    if error is CancellationError {
      return "cancelled"
    }
    return "failed"
  }

  private func reportInstallExecution(
    apiClient: InventoryAPIClient,
    executionId: String,
    plan: InstallPlan,
    installedApp: InstalledApp,
    executionRoute: ExecutionRoute,
    status: String,
    installedVersion: String?,
    errorMessage: String?,
    verification: InstallVerificationSummary?
  ) async {
    do {
      _ = try await apiClient.reportInstallExecutionStatus(
        executionId: executionId,
        plan: plan,
        installedApp: installedApp,
        executionRoute: executionRoute,
        status: status,
        installedVersion: installedVersion,
        errorMessage: errorMessage,
        verification: verification
      )
    } catch {
      Logger.api.error(
        "Failed to report install execution \(executionId) for \(installedApp.name): \(error.localizedDescription)"
      )
      PostHogTelemetry.captureException(
        error,
        properties: telemetryProperties(
          for: plan,
          route: executionRoute.rawValue,
          operation: "report_install_execution"
        )
      )
    }
  }

  private func telemetryProperties(
    for result: AppDecision,
    route: String?,
    operation: String,
    status: String? = nil,
    used_privileged_helper: Bool? = nil
  ) -> [String: Any] {
    var properties: [String: Any] = [
      "operation": operation,
      "decision": result.decision.rawValue,
      "tracking_state": result.trackingState.rawValue,
      "install_strategy": result.installStrategy?.rawValue ?? "none",
      "install_trust": result.installTrust.status.rawValue,
      "requires_admin": result.installStrategy?.requiresAdmin ?? false,
      "has_catalog_match": result.matchedAppId != nil,
      "has_artifact": result.artifact != nil,
    ]
    if let route {
      properties["execution_route"] = route
    }
    if let status {
      properties["status"] = status
    }
    if let used_privileged_helper {
      properties["used_privileged_helper"] = used_privileged_helper
    }
    return properties
  }

  private func telemetryProperties(
    for plan: InstallPlan,
    route: String,
    operation: String
  ) -> [String: Any] {
    [
      "operation": operation,
      "execution_route": route,
      "install_strategy": plan.strategy.rawValue,
      "has_catalog_app_id": plan.appId != nil,
      "has_release_id": plan.releaseId != nil,
      "has_artifact": plan.artifact != nil,
    ]
  }

  private func updateState(
    for key: String,
    appDisplayName: String? = nil,
    phase: Phase,
    detail: String,
    executionId: String?,
    errorMessage: String?,
    installedVersion: String?,
    recoveryAction: RecoveryAction?,
    helperStatus: HelperSetupState? = nil
  ) {
    let existingState = operations[key]
    operations[key] = OperationState(
      appDisplayName: appDisplayName ?? existingState?.appDisplayName,
      phase: phase,
      detail: detail,
      executionId: executionId,
      errorMessage: errorMessage,
      installedVersion: installedVersion,
      recoveryAction: recoveryAction,
      helperStatus: helperStatus ?? existingState?.helperStatus
    )
    onStateChange?()
  }

  func performRecoveryAction(_ action: RecoveryAction) {
    switch action {
    case .openSystemSettings:
      if let settingsURL = URL(
        string: "x-apple.systempreferences:com.apple.LoginItems-Settings.extension"),
        NSWorkspace.shared.open(settingsURL)
      {
        return
      }

      let configuration = NSWorkspace.OpenConfiguration()
      NSWorkspace.shared.openApplication(
        at: URL(fileURLWithPath: "/System/Applications/System Settings.app"),
        configuration: configuration
      ) { _, _ in }
    }
  }

  /// Runs `brew upgrade --cask {token}` through the privileged helper.
  /// Returns true if the upgrade completed successfully.
  @discardableResult
  func startBrewUpgrade(
    result: AppDecision,
    caskToken: String
  ) async -> Bool {
    let operationKey = result.id
    let appDisplayName = result.matchedAppName ?? result.appName

    if state(for: result).isRunning { return false }

    do {
      let executionId = UUID().uuidString
      let stagingDirectory = try makeStagingDirectory(executionId: executionId)

      updateState(
        for: operationKey,
        appDisplayName: appDisplayName,
        phase: .installing,
        detail: "Running brew upgrade --cask \(caskToken)…",
        executionId: executionId,
        errorMessage: nil,
        installedVersion: nil,
        recoveryAction: nil,
        helperStatus: .preparing
      )

      let manifest = PreparedPrivilegedOperation(
        executionId: executionId,
        operationType: .brewUpgrade,
        sourceRelativePath: ".",
        destinationPath: "",
        backupRelativePath: nil,
        installTarget: nil,
        caskToken: caskToken,
        masAppId: nil,
        masCliPath: nil
      )
      try writePreparedPrivilegedOperation(manifest, to: stagingDirectory)

      _ = try await privilegedHelperClient.performOperation(
        executionId: executionId,
        stagingDirectory: stagingDirectory
      )

      cleanupStagingDirectory(stagingDirectory)

      updateState(
        for: operationKey,
        phase: .completed,
        detail: "Upgraded \(caskToken) via Homebrew.",
        executionId: executionId,
        errorMessage: nil,
        installedVersion: nil,
        recoveryAction: nil
      )
      PostHogTelemetry.capture(
        "desktop_install_completed",
        properties: telemetryProperties(
          for: result,
          route: ExecutionRoute.brewUpgrade.rawValue,
          operation: "brew_upgrade",
          status: "succeeded",
          used_privileged_helper: true
        )
      )
      return true
    } catch {
      updateState(
        for: operationKey,
        phase: .failed,
        detail: "Homebrew upgrade failed.",
        executionId: nil,
        errorMessage: error.localizedDescription,
        installedVersion: nil,
        recoveryAction: nil
      )
      PostHogTelemetry.captureException(
        error,
        properties: telemetryProperties(
          for: result,
          route: ExecutionRoute.brewUpgrade.rawValue,
          operation: "brew_upgrade"
        )
      )
      PostHogTelemetry.capture(
        "desktop_install_failed",
        properties: telemetryProperties(
          for: result,
          route: ExecutionRoute.brewUpgrade.rawValue,
          operation: "brew_upgrade",
          status: installStatusString(for: error),
          used_privileged_helper: true
        )
      )
      return false
    }
  }

  /// Runs `mas upgrade {appId}` through the privileged helper.
  /// Returns true if the upgrade completed successfully.
  @discardableResult
  func startMasUpgrade(
    result: AppDecision,
    masAppId: String,
    masCliPath: String,
    installedApp: InstalledApp
  ) async -> Bool {
    let operationKey = result.id
    let appDisplayName = result.matchedAppName ?? result.appName

    if state(for: result).isRunning { return false }

    do {
      updateState(
        for: operationKey,
        appDisplayName: appDisplayName,
        phase: .preparing,
        detail: "Preparing Mac App Store upgrade…",
        executionId: nil,
        errorMessage: nil,
        installedVersion: nil,
        recoveryAction: nil,
        helperStatus: .notNeeded
      )

      try await ensureTargetAppIsClosed(installedApp: installedApp)

      let executionId = UUID().uuidString
      let stagingDirectory = try makeStagingDirectory(executionId: executionId)

      updateState(
        for: operationKey,
        phase: .installing,
        detail: "Running mas upgrade \(masAppId)…",
        executionId: executionId,
        errorMessage: nil,
        installedVersion: nil,
        recoveryAction: nil,
        helperStatus: .preparing
      )

      let manifest = PreparedPrivilegedOperation(
        executionId: executionId,
        operationType: .masUpgrade,
        sourceRelativePath: ".",
        destinationPath: "",
        backupRelativePath: nil,
        installTarget: nil,
        caskToken: nil,
        masAppId: masAppId,
        masCliPath: masCliPath
      )
      try writePreparedPrivilegedOperation(manifest, to: stagingDirectory)

      _ = try await privilegedHelperClient.performOperation(
        executionId: executionId,
        stagingDirectory: stagingDirectory
      )

      cleanupStagingDirectory(stagingDirectory)

      updateState(
        for: operationKey,
        phase: .completed,
        detail: "Upgraded via Mac App Store.",
        executionId: executionId,
        errorMessage: nil,
        installedVersion: nil,
        recoveryAction: nil,
        helperStatus: .ready
      )
      PostHogTelemetry.capture(
        "desktop_install_completed",
        properties: telemetryProperties(
          for: result,
          route: ExecutionRoute.masUpgrade.rawValue,
          operation: "mas_upgrade",
          status: "succeeded",
          used_privileged_helper: true
        )
      )
      return true
    } catch {
      let errorDetail =
        if let installError = error as? InstallError, case .cancelled = installError {
          "Upgrade cancelled."
        } else {
          "Mac App Store upgrade failed."
        }

      updateState(
        for: operationKey,
        phase: .failed,
        detail: errorDetail,
        executionId: nil,
        errorMessage: error.localizedDescription,
        installedVersion: nil,
        recoveryAction: recoveryAction(for: error),
        helperStatus: helperSetupState(for: error) ?? .notNeeded
      )
      PostHogTelemetry.captureException(
        error,
        properties: telemetryProperties(
          for: result,
          route: ExecutionRoute.masUpgrade.rawValue,
          operation: "mas_upgrade"
        )
      )
      PostHogTelemetry.capture(
        "desktop_install_failed",
        properties: telemetryProperties(
          for: result,
          route: ExecutionRoute.masUpgrade.rawValue,
          operation: "mas_upgrade",
          status: installStatusString(for: error),
          used_privileged_helper: true
        )
      )
      return false
    }
  }

  func recoveryActionTitle(_ action: RecoveryAction) -> String {
    switch action {
    case .openSystemSettings:
      return "Open System Settings"
    }
  }

  private func relevancePriority(for state: OperationState) -> Int {
    switch state.phase {
    case .preparing, .downloading, .verifying, .installing, .relaunching:
      return 0
    case .failed:
      return 1
    case .completed:
      return 2
    case .idle:
      return 3
    }
  }
}

@MainActor
private final class ExternalSparkleInstaller: NSObject, SPUUpdaterDelegate {
  private var continuation: CheckedContinuation<Void, Error>?
  private var updater: SPUUpdater?
  private var userDriver: SPUStandardUserDriver?
  private var foundValidUpdate = false

  func install(appAt appURL: URL) async throws {
    guard let bundle = Bundle(url: appURL) else {
      throw InstallError.verificationFailed("Could not open target app bundle for Sparkle")
    }

    let userDriver = SPUStandardUserDriver(hostBundle: bundle, delegate: nil)
    let updater = SPUUpdater(
      hostBundle: bundle,
      applicationBundle: bundle,
      userDriver: userDriver,
      delegate: self
    )

    self.userDriver = userDriver
    self.updater = updater
    self.foundValidUpdate = false

    try updater.start()

    try await withCheckedThrowingContinuation { continuation in
      self.continuation = continuation
      updater.checkForUpdates()
    }
  }

  func updater(_ updater: SPUUpdater, didFindValidUpdate _: SUAppcastItem) {
    foundValidUpdate = true
  }

  func updaterDidNotFindUpdate(_ updater: SPUUpdater) {
    foundValidUpdate = false
  }

  func updater(
    _ updater: SPUUpdater,
    didFinishUpdateCycleFor _: SPUUpdateCheck,
    error: (any Error)?
  ) {
    if let error {
      resume(with: .failure(error))
    } else if !foundValidUpdate {
      resume(
        with: .failure(InstallError.downloadFailed("Sparkle did not find an applicable update")))
    } else {
      resume(with: .success(()))
    }
  }

  func updater(_ updater: SPUUpdater, didAbortWithError error: any Error) {
    resume(with: .failure(error))
  }

  private func resume(with result: Result<Void, Error>) {
    guard let continuation else { return }
    self.continuation = nil
    self.userDriver = nil
    self.updater = nil
    continuation.resume(with: result)
  }
}

enum InstallError: LocalizedError {
  case missingArtifact
  case missingStagingDirectory
  case downloadFailed(String)
  case installerPayloadInvalid(String)
  case verificationFailed(String)
  case unsupportedStrategy
  case missingInstallTrustMaterial(String)
  case cancelled
  case privilegedHelperApprovalRequired
  case privilegedHelperRegistrationFailed(String)
  case privilegedHelperConnectionFailed(String)
  case privilegedHelperExecutionFailed(String)

  var errorDescription: String? {
    switch self {
    case .missingArtifact:
      "The install plan did not include a downloadable artifact."
    case .missingStagingDirectory:
      "Versioneer could not create a staging directory for the install."
    case .downloadFailed(let message):
      "Failed to download update: \(message)"
    case .installerPayloadInvalid(let message):
      message
    case .verificationFailed(let message):
      message
    case .unsupportedStrategy:
      "This install strategy is not supported by the current desktop app build."
    case .missingInstallTrustMaterial(let message):
      message
    case .cancelled:
      "The install was cancelled."
    case .privilegedHelperApprovalRequired:
      "Versioneer needs its privileged helper approved in System Settings before it can install updates that require admin access."
    case .privilegedHelperRegistrationFailed(let message):
      "Versioneer could not register its privileged helper: \(message)"
    case .privilegedHelperConnectionFailed(let message):
      "Versioneer could not contact its privileged helper: \(message)"
    case .privilegedHelperExecutionFailed(let message):
      message
    }
  }
}

#if DEBUG
  extension InstallCoordinator {
    func previewSetState(_ state: OperationState, for result: AppDecision) {
      operations[result.id] = state
      onStateChange?()
    }
  }
#endif
