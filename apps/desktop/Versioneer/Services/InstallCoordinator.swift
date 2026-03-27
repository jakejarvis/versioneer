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

  nonisolated enum ExecutionRoute: Equatable, Sendable {
    case sparkle
    case localReplace
    case privilegedReplace
    case privilegedPackage
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

  nonisolated struct VerificationSummary: Codable, Sendable {
    let strategy: String
    var hashVerified: Bool?
    var signatureVerified: Bool?
    var notarizationVerified: Bool?
    var bundleIdMatch: Bool?
    var teamIdMatch: Bool?
    var versionMatch: Bool?
    var observedBundleId: String?
    var observedTeamId: String?
    var observedVersion: String?
  }

  private var operations: [String: OperationState] = [:]
  private let privilegedHelperClient: any PrivilegedHelperClientProtocol

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
    snapshotId: String,
    apiClient: InventoryAPIClient
  ) async -> Bool {
    guard result.install.canInstall else { return false }
    if state(for: result).isRunning { return false }

    let startedAt = Date()
    let operationKey = result.id
    let appDisplayName = result.matchedAppName ?? result.appName
    var executionId: String?
    var verificationSummary = VerificationSummary(
      strategy: result.install.strategy?.rawValue ?? "unknown")
    var stagedDirectory: URL?
    var usedPrivilegedHelper = false

    do {
      updateState(
        for: operationKey,
        appDisplayName: appDisplayName,
        phase: .preparing,
        detail: "Requesting install plan…",
        executionId: nil,
        errorMessage: nil,
        installedVersion: nil,
        recoveryAction: nil,
        helperStatus: .notNeeded
      )

      let prepared = try await apiClient.prepareInstall(
        snapshotId: snapshotId,
        result: result,
        installedApp: installedApp
      )
      executionId = prepared.executionId
      stagedDirectory = try makeStagingDirectory(executionId: prepared.executionId)

      try await reportStatus(
        apiClient: apiClient,
        executionId: prepared.executionId,
        status: .inProgress,
        startedAt: startedAt,
        details: ["phase": "preparing", "strategy": prepared.plan.strategy.rawValue]
      )

      switch prepared.plan.strategy {
      case .sparkle:
        updateState(
          for: operationKey,
          phase: .installing,
          detail: "Running the app's Sparkle updater…",
          executionId: prepared.executionId,
          errorMessage: nil,
          installedVersion: nil,
          recoveryAction: nil,
          helperStatus: .notNeeded
        )
        try await ExternalSparkleInstaller().install(appAt: URL(fileURLWithPath: installedApp.path))
        verificationSummary = VerificationSummary(strategy: prepared.plan.strategy.rawValue)

      case .zipReplace, .dmgCopyReplace:
        guard let stagingDir = stagedDirectory else { throw InstallError.missingStagingDirectory }
        let artifactURL = try await downloadArtifact(plan: prepared.plan, to: stagingDir)
        let preparedBundle = try await prepareAppBundle(
          strategy: prepared.plan.strategy,
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
          executionId: prepared.executionId,
          errorMessage: nil,
          installedVersion: nil,
          recoveryAction: nil,
          helperStatus: .notNeeded
        )
        verificationSummary = try await verifyAppBundle(
          bundleURL: preparedBundle.appBundleURL,
          downloadedArtifactURL: artifactURL,
          plan: prepared.plan
        )

        try await ensureTargetAppIsClosed(installedApp: installedApp)

        let destinationAppURL = URL(fileURLWithPath: installedApp.path)
        switch executionRoute(for: prepared.plan, destinationAppURL: destinationAppURL) {
        case .localReplace:
          updateState(
            for: operationKey,
            phase: .installing,
            detail: "Replacing installed app…",
            executionId: prepared.executionId,
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
            executionId: prepared.executionId,
            errorMessage: nil,
            installedVersion: nil,
            recoveryAction: nil,
            helperStatus: .preparing
          )
          try await replaceInstalledAppViaHelper(
            executionId: prepared.executionId,
            sourceAppURL: preparedBundle.appBundleURL,
            destinationAppURL: destinationAppURL,
            stagingDirectory: stagingDir
          )

        case .sparkle, .privilegedPackage:
          throw InstallError.unsupportedStrategy
        }

        if prepared.plan.relaunchAfterInstall {
          updateState(
            for: operationKey,
            phase: .relaunching,
            detail: "Relaunching app…",
            executionId: prepared.executionId,
            errorMessage: nil,
            installedVersion: nil,
            recoveryAction: nil,
            helperStatus: usedPrivilegedHelper ? .ready : .notNeeded
          )
          try await relaunchApp(at: URL(fileURLWithPath: installedApp.path))
        }

      case .pkgInstall:
        guard let stagingDir = stagedDirectory else { throw InstallError.missingStagingDirectory }
        let artifactURL = try await downloadArtifact(plan: prepared.plan, to: stagingDir)

        updateState(
          for: operationKey,
          phase: .verifying,
          detail: "Verifying package…",
          executionId: prepared.executionId,
          errorMessage: nil,
          installedVersion: nil,
          recoveryAction: nil,
          helperStatus: .notNeeded
        )
        verificationSummary = try await verifyPackage(
          packageURL: artifactURL,
          plan: prepared.plan
        )

        usedPrivilegedHelper = true
        updateState(
          for: operationKey,
          phase: .installing,
          detail: "Setting up privileged installer…",
          executionId: prepared.executionId,
          errorMessage: nil,
          installedVersion: nil,
          recoveryAction: nil,
          helperStatus: .preparing
        )
        try await installPackageViaHelper(
          executionId: prepared.executionId,
          packageURL: artifactURL,
          stagingDirectory: stagingDir
        )

      case .pkgManual, .manualOnly:
        throw InstallError.unsupportedStrategy
      }

      let installedVersion = readInstalledVersion(at: URL(fileURLWithPath: installedApp.path))
      if let executionId {
        try await reportStatus(
          apiClient: apiClient,
          executionId: executionId,
          status: .completed,
          startedAt: startedAt,
          clientVersionAfter: installedVersion,
          detailsJSONString: encodeVerificationSummary(verificationSummary)
        )
      }

      updateState(
        for: operationKey,
        phase: .completed,
        detail: "Install completed.",
        executionId: executionId,
        errorMessage: nil,
        installedVersion: installedVersion,
        recoveryAction: nil,
        helperStatus: usedPrivilegedHelper ? .ready : .notNeeded
      )
      cleanupStagingDirectory(stagedDirectory)
      return true
    } catch {
      Logger.install.error("Install failed for \(installedApp.name): \(error.localizedDescription)")
      if let executionId {
        try? await reportStatus(
          apiClient: apiClient,
          executionId: executionId,
          status: .failed,
          startedAt: startedAt,
          errorMessage: error.localizedDescription,
          detailsJSONString: encodeVerificationSummary(verificationSummary)
        )
      }

      updateState(
        for: operationKey,
        phase: .failed,
        detail: "Install failed.",
        executionId: executionId,
        errorMessage: error.localizedDescription,
        installedVersion: nil,
        recoveryAction: recoveryAction(for: error),
        helperStatus: helperSetupState(for: error) ?? (usedPrivilegedHelper ? .failed : .notNeeded)
      )
      cleanupStagingDirectory(stagedDirectory)
      return false
    }
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

  func recoveryActionTitle(_ action: RecoveryAction) -> String {
    switch action {
    case .openSystemSettings:
      return "Open System Settings"
    }
  }

  private func reportStatus(
    apiClient: InventoryAPIClient,
    executionId: String,
    status: InstallExecutionStatusUpdate.ActionStatus,
    startedAt: Date,
    clientVersionAfter: String? = nil,
    errorMessage: String? = nil,
    details: [String: String]? = nil,
    detailsJSONString: String? = nil
  ) async throws {
    let renderedDetails: String? =
      if let detailsJSONString {
        detailsJSONString
      } else if let details {
        try details.asJSONString()
      } else {
        nil
      }

    try await apiClient.updateInstallExecution(
      executionId: executionId,
      status: InstallExecutionStatusUpdate(
        installId: Self.installIdentifier(),
        actionStatus: status,
        clientVersionAfter: clientVersionAfter,
        errorMessage: errorMessage,
        durationMs: Int(Date().timeIntervalSince(startedAt) * 1000),
        detailsJson: renderedDetails
      )
    )
  }

  private func downloadArtifact(plan: InstallPlan, to stagingDirectory: URL) async throws -> URL {
    guard let artifact = plan.artifact,
      let downloadURLString = artifact.downloadUrl,
      let downloadURL = URL(string: downloadURLString)
    else {
      throw InstallError.missingArtifact
    }

    let fileExtension =
      if !downloadURL.pathExtension.isEmpty {
        downloadURL.pathExtension
      } else {
        switch plan.strategy {
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
    strategy: AppDecision.Install.Strategy,
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
    plan: InstallPlan
  ) async throws -> VerificationSummary {
    var summary = VerificationSummary(strategy: plan.strategy.rawValue)
    try await verifyArtifactHashIfNeeded(
      artifactURL: downloadedArtifactURL,
      expectedHash: plan.artifact?.sha256,
      required: plan.localVerification.requireHash
    )
    summary.hashVerified = plan.localVerification.requireHash ? true : nil

    let metadata = readBundleMetadata(at: bundleURL)
    summary.observedBundleId = metadata.bundleId
    summary.observedVersion = metadata.version
    summary.observedTeamId = metadata.teamId

    if plan.localVerification.requireSignature || plan.localVerification.requireTeamIdMatch {
      let result = try await ProcessRunner.runSuccessful(
        "/usr/bin/codesign",
        arguments: ["-dv", "--verbose=4", bundleURL.path]
      )
      let combinedOutput = result.stdout + "\n" + result.stderr
      summary.signatureVerified = true
      summary.observedTeamId =
        parseCodesignField("TeamIdentifier", from: combinedOutput) ?? summary.observedTeamId
    }

    if plan.localVerification.requireNotarization {
      _ = try await ProcessRunner.runSuccessful(
        "/usr/sbin/spctl",
        arguments: ["--assess", "--type", "execute", "-vv", bundleURL.path]
      )
      summary.notarizationVerified = true
    }

    if plan.localVerification.requireBundleIdMatch {
      guard summary.observedBundleId == plan.artifact?.expectedBundleId else {
        throw InstallError.verificationFailed("Bundle identifier did not match the install plan")
      }
      summary.bundleIdMatch = true
    }

    if plan.localVerification.requireTeamIdMatch {
      guard summary.observedTeamId == plan.artifact?.expectedTeamId else {
        throw InstallError.verificationFailed("Team identifier did not match the install plan")
      }
      summary.teamIdMatch = true
    }

    if plan.localVerification.requireVersionMatch {
      guard summary.observedVersion == plan.artifact?.expectedVersionRaw else {
        throw InstallError.verificationFailed("Version did not match the install plan")
      }
      summary.versionMatch = true
    }

    return summary
  }

  private func verifyPackage(
    packageURL: URL,
    plan: InstallPlan
  ) async throws -> VerificationSummary {
    var summary = VerificationSummary(strategy: plan.strategy.rawValue)

    try await verifyArtifactHashIfNeeded(
      artifactURL: packageURL,
      expectedHash: plan.artifact?.sha256,
      required: plan.localVerification.requireHash
    )
    summary.hashVerified = plan.localVerification.requireHash ? true : nil

    if plan.localVerification.requireSignature || plan.localVerification.requireTeamIdMatch {
      let result = try await ProcessRunner.runSuccessful(
        "/usr/sbin/pkgutil",
        arguments: ["--check-signature", packageURL.path]
      )
      summary.signatureVerified = true
      summary.observedTeamId = parseTeamIDFromPackageSignature(result.stdout + "\n" + result.stderr)
    }

    if plan.localVerification.requireNotarization {
      _ = try await ProcessRunner.runSuccessful(
        "/usr/sbin/spctl",
        arguments: ["--assess", "--type", "install", "-vv", packageURL.path]
      )
      summary.notarizationVerified = true
    }

    if plan.localVerification.requireTeamIdMatch {
      guard summary.observedTeamId == plan.artifact?.expectedTeamId else {
        throw InstallError.verificationFailed(
          "Installer team identifier did not match the install plan")
      }
      summary.teamIdMatch = true
    }

    return summary
  }

  private func verifyArtifactHashIfNeeded(
    artifactURL: URL,
    expectedHash: String?,
    required: Bool
  ) async throws {
    guard required else { return }
    guard let expectedHash else {
      throw InstallError.verificationFailed(
        "Install plan required a SHA-256 hash but none was supplied")
    }

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
    destinationAppURL: URL? = nil
  ) -> ExecutionRoute {
    switch plan.strategy {
    case .sparkle:
      return .sparkle
    case .zipReplace, .dmgCopyReplace:
      guard let destinationAppURL else { return .localReplace }
      let needsPrivilege =
        plan.requiresAdmin
        || !FileManager.default.isWritableFile(
          atPath: destinationAppURL.deletingLastPathComponent().path)
      return needsPrivilege ? .privilegedReplace : .localReplace
    case .pkgInstall:
      return .privilegedPackage
    case .pkgManual, .manualOnly:
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
      installTarget: nil
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
      installTarget: "/"
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
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    let executionDirectory = PrivilegedInstallPaths.stagingDirectory(
      executionId: executionId,
      in: FileManager.default.homeDirectoryForCurrentUser
    )
    if FileManager.default.fileExists(atPath: executionDirectory.path) {
      try FileManager.default.removeItem(at: executionDirectory)
    }
    try FileManager.default.createDirectory(
      at: executionDirectory, withIntermediateDirectories: true)
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
  }

  private func readBundleMetadata(at bundleURL: URL) -> BundleMetadata {
    guard let bundle = Bundle(url: bundleURL) else {
      return BundleMetadata(bundleId: nil, version: nil, teamId: nil)
    }
    let info = bundle.infoDictionary ?? [:]
    let bundleId = info["CFBundleIdentifier"] as? String
    let version = info["CFBundleShortVersionString"] as? String
    return BundleMetadata(bundleId: bundleId, version: version, teamId: nil)
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

  private func encodeVerificationSummary(_ summary: VerificationSummary) -> String? {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys]
    return try? String(data: encoder.encode(summary), encoding: .utf8)
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

  private static func installIdentifier() -> String {
    let key = "versioneer_install_id"
    if let existing = UserDefaults.standard.string(forKey: key) {
      return existing
    }
    let newId = UUID().uuidString
    UserDefaults.standard.set(newId, forKey: key)
    return newId
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

extension Dictionary where Key == String, Value == String {
  fileprivate func asJSONString() throws -> String {
    let data = try JSONSerialization.data(withJSONObject: self, options: [.sortedKeys])
    return String(decoding: data, as: UTF8.self)
  }
}

#if DEBUG
  extension InstallCoordinator {
    func previewSetState(_ state: OperationState, for result: AppDecision) {
      operations[result.id] = state
    }
  }
#endif
