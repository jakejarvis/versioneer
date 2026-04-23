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
  private let privilegedHelperClient: any PrivilegedHelperClientProtocol

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
          executionId = prepared.executionId
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

  private func downloadArtifact(
    artifact: AppDecision.Artifact?,
    strategy: InstallStrategy,
    to stagingDirectory: URL
  ) async throws -> URL {
    guard let artifact,
      let downloadURLString = artifact.downloadUrl,
      let downloadURL = URL(string: downloadURLString)
    else {
      throw InstallError.missingArtifact
    }

    let fileExtension =
      if !downloadURL.pathExtension.isEmpty {
        downloadURL.pathExtension
      } else {
        switch strategy {
        case .zipReplace: "zip"
        case .dmgCopyReplace: "dmg"
        case .pkgInstall: "pkg"
        default: "bin"
        }
      }

    let destinationURL = stagingDirectory.appendingPathComponent("download.\(fileExtension)")
    Logger.install.info("Downloading artifact from \(downloadURL.absoluteString)")

    let (temporaryURL, response) = try await URLSession.shared.download(from: downloadURL)
    guard let httpResponse = response as? HTTPURLResponse,
      (200..<300).contains(httpResponse.statusCode)
    else {
      throw InstallError.downloadFailed("Server returned an invalid response")
    }

    if FileManager.default.fileExists(atPath: destinationURL.path) {
      try FileManager.default.removeItem(at: destinationURL)
    }
    try FileManager.default.moveItem(at: temporaryURL, to: destinationURL)
    return destinationURL
  }

  private struct PreparedBundle {
    let appBundleURL: URL
    let mountedVolumeURL: URL?
  }

  private func prepareAppBundle(
    strategy: InstallStrategy,
    artifactURL: URL,
    stagingDirectory: URL
  ) async throws -> PreparedBundle {
    switch strategy {
    case .zipReplace:
      let extractionURL = stagingDirectory.appendingPathComponent("unzipped", isDirectory: true)
      try FileManager.default.createDirectory(at: extractionURL, withIntermediateDirectories: true)
      try await ProcessRunner.runSuccessful(
        "/usr/bin/ditto",
        arguments: ["-x", "-k", artifactURL.path, extractionURL.path]
      )

      guard let appBundleURL = findFirstAppBundle(in: extractionURL) else {
        throw InstallError.installerPayloadInvalid("Archive did not contain an .app bundle")
      }
      return PreparedBundle(appBundleURL: appBundleURL, mountedVolumeURL: nil)

    case .dmgCopyReplace:
      let mountedVolumeURL = try await mountDiskImage(at: artifactURL)
      guard let appBundleURL = findFirstAppBundle(in: mountedVolumeURL) else {
        throw InstallError.installerPayloadInvalid("Disk image did not contain an .app bundle")
      }
      return PreparedBundle(appBundleURL: appBundleURL, mountedVolumeURL: mountedVolumeURL)

    default:
      throw InstallError.unsupportedStrategy
    }
  }

  private func mountDiskImage(at dmgURL: URL) async throws -> URL {
    let result = try await ProcessRunner.runSuccessful(
      "/usr/bin/hdiutil",
      arguments: ["attach", "-nobrowse", "-readonly", dmgURL.path]
    )

    for line in result.stdout.split(separator: "\n").reversed() {
      let parts = line.split(separator: "\t")
      if let mountPoint = parts.last, mountPoint.hasPrefix("/") {
        return URL(fileURLWithPath: String(mountPoint))
      }
    }

    throw InstallError.installerPayloadInvalid("Could not determine mounted volume path")
  }

  private func unmountDiskImage(at mountPoint: URL) async throws {
    _ = try await ProcessRunner.runSuccessful(
      "/usr/bin/hdiutil",
      arguments: ["detach", mountPoint.path]
    )
  }

  private func verifyAppBundle(
    bundleURL: URL,
    downloadedArtifactURL: URL,
    expectedHash: String?,
    targetArchitecture: String?,
    installedApp: InstalledApp,
    strategy: InstallStrategy,
    executionRoute: ExecutionRoute?
  ) async throws -> InstallVerificationSummary {
    var summary = InstallVerificationSummary(
      strategy: strategy.rawValue,
      executionRoute: executionRoute?.rawValue
    )

    // Verify hash if the server provided one
    if let expectedHash {
      try await verifyArtifactHash(artifactURL: downloadedArtifactURL, expectedHash: expectedHash)
      summary.hashVerified = true
    }

    let metadata = readBundleMetadata(at: bundleURL)
    summary.observedBundleId = metadata.bundleId
    summary.observedVersion = metadata.version
    summary.observedTeamId = metadata.teamId
    if let targetArchitecture,
      let bundleArchitecture = metadata.architecture,
      !Self.bundleArchitectureSupportsTarget(
        bundleArchitecture: bundleArchitecture,
        targetArchitecture: targetArchitecture
      )
    {
      throw InstallError.verificationFailed(
        "Downloaded app architecture \(bundleArchitecture) is not compatible with target architecture \(targetArchitecture)"
      )
    }

    // Always verify code signature
    let result = try await ProcessRunner.runSuccessful(
      "/usr/bin/codesign",
      arguments: ["-dv", "--verbose=4", bundleURL.path]
    )
    let combinedOutput = result.stdout + "\n" + result.stderr
    summary.signatureVerified = true
    summary.observedTeamId =
      parseCodesignField("TeamIdentifier", from: combinedOutput) ?? summary.observedTeamId

    // Always verify notarization
    _ = try await ProcessRunner.runSuccessful(
      "/usr/sbin/spctl",
      arguments: ["--assess", "--type", "execute", "-vv", bundleURL.path]
    )
    summary.notarizationVerified = true

    // Verify bundle ID matches the installed app
    if let expectedBundleId = installedApp.bundleId {
      guard summary.observedBundleId == expectedBundleId else {
        throw InstallError.verificationFailed("Bundle identifier did not match the installed app")
      }
      summary.bundleIdMatch = true
    }

    // Verify team ID matches the installed app
    if let expectedTeamId = installedApp.teamId {
      guard summary.observedTeamId == expectedTeamId else {
        throw InstallError.verificationFailed("Team identifier did not match the installed app")
      }
      summary.teamIdMatch = true
    }

    return summary
  }

  private func validateCatalogInstallTrust(
    plan: InstallPlan,
    installedApp: InstalledApp
  ) throws {
    guard plan.isCatalogBacked else { return }

    switch plan.strategy {
    case .zipReplace, .dmgCopyReplace, .pkgInstall:
      guard installedApp.bundleId?.isEmpty == false else {
        throw InstallError.missingInstallTrustMaterial(
          "Catalog-backed installs require the installed app's bundle identifier before Versioneer can replace it."
        )
      }
      guard installedApp.teamId?.isEmpty == false else {
        throw InstallError.missingInstallTrustMaterial(
          "Catalog-backed installs require the installed app's Developer Team ID before Versioneer can replace it."
        )
      }
    case .sparkle, .macAppStore, .manualOnly:
      return
    }
  }

  private func verifyPackage(
    packageURL: URL,
    expectedHash: String?,
    installedApp: InstalledApp,
    strategy: InstallStrategy,
    executionRoute: ExecutionRoute?
  ) async throws -> InstallVerificationSummary {
    var summary = InstallVerificationSummary(
      strategy: strategy.rawValue,
      executionRoute: executionRoute?.rawValue
    )

    // Verify hash if the server provided one
    if let expectedHash {
      try await verifyArtifactHash(artifactURL: packageURL, expectedHash: expectedHash)
      summary.hashVerified = true
    }

    // Always verify package signature
    let result = try await ProcessRunner.runSuccessful(
      "/usr/sbin/pkgutil",
      arguments: ["--check-signature", packageURL.path]
    )
    summary.signatureVerified = true
    summary.observedTeamId = parseTeamIDFromPackageSignature(result.stdout + "\n" + result.stderr)

    // Always verify notarization
    _ = try await ProcessRunner.runSuccessful(
      "/usr/sbin/spctl",
      arguments: ["--assess", "--type", "install", "-vv", packageURL.path]
    )
    summary.notarizationVerified = true

    // Verify team ID matches the installed app
    if let expectedTeamId = installedApp.teamId {
      guard summary.observedTeamId == expectedTeamId else {
        throw InstallError.verificationFailed(
          "Installer team identifier did not match the installed app")
      }
      summary.teamIdMatch = true
    }

    return summary
  }

  private func verifyArtifactHash(
    artifactURL: URL,
    expectedHash: String
  ) async throws {
    let result = try await ProcessRunner.runSuccessful(
      "/usr/bin/shasum",
      arguments: ["-a", "256", artifactURL.path]
    )
    let actualHash = result.stdout.split(separator: " ").first.map(String.init)?.lowercased()
    guard actualHash == expectedHash.lowercased() else {
      throw InstallError.verificationFailed(
        "Downloaded artifact hash did not match the install plan")
    }
  }

  private func ensureTargetAppIsClosed(installedApp: InstalledApp) async throws {
    let runningApps = runningApplications(for: installedApp)
    guard !runningApps.isEmpty else { return }

    let alert = NSAlert()
    alert.messageText = "Quit \(installedApp.name) to continue?"
    alert.informativeText = "\(installedApp.name) must be closed before Versioneer can replace it."
    alert.addButton(withTitle: "Quit and Install")
    alert.addButton(withTitle: "Cancel")

    guard alert.runModal() == .alertFirstButtonReturn else {
      throw InstallError.cancelled
    }

    for app in runningApps {
      _ = app.terminate()
    }

    for _ in 0..<30 {
      try await Task.sleep(for: .milliseconds(200))
      if runningApplications(for: installedApp).isEmpty {
        return
      }
    }

    for app in runningApps {
      _ = app.forceTerminate()
    }

    try await Task.sleep(for: .milliseconds(500))
    if !runningApplications(for: installedApp).isEmpty {
      throw InstallError.cancelled
    }
  }

  func executionRoute(
    for plan: InstallPlan,
    destinationAppURL: URL? = nil,
    isDirectoryWritable: ((String) -> Bool)? = nil
  ) -> ExecutionRoute {
    let checkWritable = isDirectoryWritable ?? { FileManager.default.isWritableFile(atPath: $0) }
    switch plan.strategy {
    case .sparkle:
      return .sparkle
    case .zipReplace, .dmgCopyReplace:
      guard let destinationAppURL else { return .localReplace }
      let needsPrivilege =
        plan.strategy.requiresAdmin
        || !checkWritable(destinationAppURL.deletingLastPathComponent().path)
      return needsPrivilege ? .privilegedReplace : .localReplace
    case .pkgInstall:
      return .privilegedPackage
    case .macAppStore:
      return .localReplace
    case .manualOnly:
      return .localReplace
    }
  }

  private func replaceInstalledAppLocally(
    sourceAppURL: URL,
    destinationAppURL: URL,
    stagingDirectory: URL
  ) async throws {
    let backupURL =
      stagingDirectory
      .appendingPathComponent("local-backups", isDirectory: true)
      .appendingPathComponent(destinationAppURL.lastPathComponent, isDirectory: true)

    _ = try await Task.detached(priority: .userInitiated) {
      try PrivilegedOperationPerformer.replaceApp(
        sourceURL: sourceAppURL,
        destinationURL: destinationAppURL,
        backupURL: backupURL
      )
    }.value
  }

  private func replaceInstalledAppViaHelper(
    executionId: String,
    sourceAppURL: URL,
    destinationAppURL: URL,
    stagingDirectory: URL
  ) async throws {
    let helperSourceURL = try await stageAppBundleForHelper(
      sourceAppURL: sourceAppURL,
      stagingDirectory: stagingDirectory
    )
    let manifest = PreparedPrivilegedOperation(
      executionId: executionId,
      operationType: .replaceApp,
      sourceRelativePath: relativePath(from: stagingDirectory, to: helperSourceURL),
      destinationPath: destinationAppURL.path,
      backupRelativePath: "helper-backups/\(destinationAppURL.lastPathComponent)",
      installTarget: nil,
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try writePreparedPrivilegedOperation(manifest, to: stagingDirectory)
    _ = try await privilegedHelperClient.performOperation(
      executionId: executionId,
      stagingDirectory: stagingDirectory
    )
  }

  private func installPackageViaHelper(
    executionId: String,
    packageURL: URL,
    stagingDirectory: URL
  ) async throws {
    let manifest = PreparedPrivilegedOperation(
      executionId: executionId,
      operationType: .installPackage,
      sourceRelativePath: relativePath(from: stagingDirectory, to: packageURL),
      destinationPath: "/",
      backupRelativePath: nil,
      installTarget: "/",
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try writePreparedPrivilegedOperation(manifest, to: stagingDirectory)
    _ = try await privilegedHelperClient.performOperation(
      executionId: executionId,
      stagingDirectory: stagingDirectory
    )
  }

  private func relaunchApp(at url: URL) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
      let configuration = NSWorkspace.OpenConfiguration()
      configuration.activates = true
      NSWorkspace.shared.openApplication(at: url, configuration: configuration) { _, error in
        if let error {
          continuation.resume(throwing: error)
        } else {
          continuation.resume(returning: ())
        }
      }
    }
  }

  private func runningApplications(for installedApp: InstalledApp) -> [NSRunningApplication] {
    let appURL = URL(fileURLWithPath: installedApp.path)
    return NSWorkspace.shared.runningApplications.filter { application in
      if let bundleIdentifier = installedApp.bundleId,
        application.bundleIdentifier == bundleIdentifier
      {
        return true
      }

      guard let executableURL = application.executableURL else { return false }
      let currentURL =
        executableURL
        .deletingLastPathComponent()
        .deletingLastPathComponent()
        .deletingLastPathComponent()
      return currentURL.path == appURL.path
    }
  }

  private func makeStagingDirectory(executionId: String) throws -> URL {
    let root = PrivilegedInstallPaths.stagingRoot(
      in: FileManager.default.homeDirectoryForCurrentUser)
    let ownerOnlyAttributes: [FileAttributeKey: Any] = [.posixPermissions: 0o700]
    try FileManager.default.createDirectory(
      at: root, withIntermediateDirectories: true, attributes: ownerOnlyAttributes)
    try FileManager.default.setAttributes(ownerOnlyAttributes, ofItemAtPath: root.path)
    let executionDirectory = PrivilegedInstallPaths.stagingDirectory(
      executionId: executionId,
      in: FileManager.default.homeDirectoryForCurrentUser
    )
    if FileManager.default.fileExists(atPath: executionDirectory.path) {
      try FileManager.default.removeItem(at: executionDirectory)
    }
    try FileManager.default.createDirectory(
      at: executionDirectory, withIntermediateDirectories: true, attributes: ownerOnlyAttributes)
    try FileManager.default.setAttributes(
      ownerOnlyAttributes, ofItemAtPath: executionDirectory.path)
    return executionDirectory
  }

  private func cleanupStagingDirectory(_ url: URL?) {
    guard let url else { return }
    try? FileManager.default.removeItem(at: url)
  }

  private func findFirstAppBundle(in root: URL) -> URL? {
    let fileManager = FileManager.default
    if root.pathExtension == "app" { return root }

    guard
      let enumerator = fileManager.enumerator(
        at: root,
        includingPropertiesForKeys: [.isDirectoryKey],
        options: [.skipsHiddenFiles]
      )
    else {
      return nil
    }

    for case let url as URL in enumerator where url.pathExtension == "app" {
      return url
    }
    return nil
  }

  private struct BundleMetadata {
    let bundleId: String?
    let version: String?
    let teamId: String?
    let architecture: String?
  }

  private func readBundleMetadata(at bundleURL: URL) -> BundleMetadata {
    guard let bundle = Bundle(url: bundleURL) else {
      return BundleMetadata(bundleId: nil, version: nil, teamId: nil, architecture: nil)
    }
    let info = bundle.infoDictionary ?? [:]
    let bundleId = info["CFBundleIdentifier"] as? String
    let version = info["CFBundleShortVersionString"] as? String
    let architecture = BundleMetadataReader.readApp(at: bundleURL)?.architecture
    return BundleMetadata(
      bundleId: bundleId, version: version, teamId: nil, architecture: architecture)
  }

  nonisolated static func bundleArchitectureSupportsTarget(
    bundleArchitecture: String?,
    targetArchitecture: String?
  ) -> Bool {
    guard let normalizedBundle = normalizedArchitecture(bundleArchitecture),
      let normalizedTarget = normalizedArchitecture(targetArchitecture)
    else {
      return true
    }

    if normalizedBundle == "universal" || normalizedBundle == normalizedTarget {
      return true
    }

    return normalizedTarget == "arm64" && normalizedBundle == "x86_64"
  }

  nonisolated static func systemArchitecture() -> String? {
    var size = 256
    var machine = [CChar](repeating: 0, count: size)
    guard sysctlbyname("hw.machine", &machine, &size, nil, 0) == 0 else {
      return nil
    }

    let reported = String(
      decoding: machine.prefix { $0 != 0 }.map { UInt8(bitPattern: $0) },
      as: UTF8.self
    )

    if reported == "x86_64" {
      var translated: Int32 = 0
      var translatedSize = MemoryLayout<Int32>.size
      if sysctlbyname("sysctl.proc_translated", &translated, &translatedSize, nil, 0) == 0,
        translated == 1
      {
        return "arm64"
      }
    }

    return normalizedArchitecture(reported)
  }

  nonisolated private static func normalizedArchitecture(_ value: String?) -> String? {
    guard let value else { return nil }
    let normalized = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    switch normalized {
    case "arm64", "aarch64":
      return "arm64"
    case "x86_64", "x86-64", "amd64", "intel":
      return "x86_64"
    case "universal", "universal2", "fat":
      return "universal"
    default:
      return nil
    }
  }

  private func readInstalledVersion(at appURL: URL) -> String? {
    guard let bundle = Bundle(url: appURL) else { return nil }
    return bundle.infoDictionary?["CFBundleShortVersionString"] as? String
  }

  private func parseCodesignField(_ field: String, from output: String) -> String? {
    let prefix = "\(field)="
    for line in output.split(separator: "\n") {
      guard line.hasPrefix(prefix) else { continue }
      return String(line.dropFirst(field.count + 1)).trimmingCharacters(in: .whitespaces)
    }
    return nil
  }

  private func parseTeamIDFromPackageSignature(_ output: String) -> String? {
    let pattern = #"\(([A-Z0-9]{10})\)"#
    guard let regex = try? NSRegularExpression(pattern: pattern) else { return nil }
    let range = NSRange(output.startIndex..., in: output)
    guard let match = regex.firstMatch(in: output, range: range),
      let matchRange = Range(match.range(at: 1), in: output)
    else {
      return nil
    }
    return String(output[matchRange])
  }

  private func recoveryAction(for error: Error) -> RecoveryAction? {
    guard let installError = error as? InstallError else { return nil }
    switch installError {
    case .privilegedHelperApprovalRequired:
      return .openSystemSettings
    default:
      return nil
    }
  }

  private func helperSetupState(for error: Error) -> HelperSetupState? {
    guard let installError = error as? InstallError else { return nil }
    switch installError {
    case .privilegedHelperApprovalRequired:
      return .approvalRequired
    case .privilegedHelperRegistrationFailed:
      return .unavailable
    case .privilegedHelperConnectionFailed, .privilegedHelperExecutionFailed:
      return .failed
    default:
      return nil
    }
  }

  private func stageAppBundleForHelper(
    sourceAppURL: URL,
    stagingDirectory: URL
  ) async throws -> URL {
    let helperSourceRoot = stagingDirectory.appendingPathComponent(
      "helper-source", isDirectory: true)
    try FileManager.default.createDirectory(at: helperSourceRoot, withIntermediateDirectories: true)
    let stagedSourceURL = helperSourceRoot.appendingPathComponent(
      sourceAppURL.lastPathComponent, isDirectory: true)

    if FileManager.default.fileExists(atPath: stagedSourceURL.path) {
      try FileManager.default.removeItem(at: stagedSourceURL)
    }

    _ = try await ProcessRunner.runSuccessful(
      "/usr/bin/ditto",
      arguments: [sourceAppURL.path, stagedSourceURL.path]
    )
    return stagedSourceURL
  }

  private func writePreparedPrivilegedOperation(
    _ manifest: PreparedPrivilegedOperation,
    to stagingDirectory: URL
  ) throws {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
    let data = try encoder.encode(manifest)
    try data.write(
      to: PreparedPrivilegedOperation.manifestURL(in: stagingDirectory), options: [.atomic])
  }

  private func relativePath(from root: URL, to child: URL) -> String {
    let rootPath = root.standardizedFileURL.path
    let childPath = child.standardizedFileURL.path
    guard childPath == rootPath || childPath.hasPrefix(rootPath + "/") else {
      return child.lastPathComponent
    }
    return String(childPath.dropFirst(rootPath.count + 1))
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
