import AppKit
import Foundation
import Logging

@MainActor
extension InstallCoordinator {
  struct PreparedBundle {
    let appBundleURL: URL
    let mountedVolumeURL: URL?
  }

  func downloadArtifact(
    artifact: InventoryResult.Artifact?,
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

  func prepareAppBundle(
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

  func verifyAppBundle(
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

    let result = try await ProcessRunner.runSuccessful(
      "/usr/bin/codesign",
      arguments: ["-dv", "--verbose=4", bundleURL.path]
    )
    let combinedOutput = result.stdout + "\n" + result.stderr
    summary.signatureVerified = true
    summary.observedTeamId =
      parseCodesignField("TeamIdentifier", from: combinedOutput) ?? summary.observedTeamId

    _ = try await ProcessRunner.runSuccessful(
      "/usr/sbin/spctl",
      arguments: ["--assess", "--type", "execute", "-vv", bundleURL.path]
    )
    summary.notarizationVerified = true

    if let expectedBundleId = installedApp.bundleId {
      guard summary.observedBundleId == expectedBundleId else {
        throw InstallError.verificationFailed("Bundle identifier did not match the installed app")
      }
      summary.bundleIdMatch = true
    }

    if let expectedTeamId = installedApp.teamId {
      guard summary.observedTeamId == expectedTeamId else {
        throw InstallError.verificationFailed("Team identifier did not match the installed app")
      }
      summary.teamIdMatch = true
    }

    return summary
  }

  func validateCatalogInstallTrust(
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

  func verifyPackage(
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

    if let expectedHash {
      try await verifyArtifactHash(artifactURL: packageURL, expectedHash: expectedHash)
      summary.hashVerified = true
    }

    let result = try await ProcessRunner.runSuccessful(
      "/usr/sbin/pkgutil",
      arguments: ["--check-signature", packageURL.path]
    )
    summary.signatureVerified = true
    summary.observedTeamId = parseTeamIDFromPackageSignature(result.stdout + "\n" + result.stderr)

    _ = try await ProcessRunner.runSuccessful(
      "/usr/sbin/spctl",
      arguments: ["--assess", "--type", "install", "-vv", packageURL.path]
    )
    summary.notarizationVerified = true

    if let expectedTeamId = installedApp.teamId {
      guard summary.observedTeamId == expectedTeamId else {
        throw InstallError.verificationFailed(
          "Installer team identifier did not match the installed app")
      }
      summary.teamIdMatch = true
    }

    return summary
  }

  func ensureTargetAppIsClosed(installedApp: InstalledApp) async throws {
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
    case .macAppStore, .manualOnly:
      return .localReplace
    }
  }

  func replaceInstalledAppLocally(
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

  func replaceInstalledAppViaHelper(
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

  func installPackageViaHelper(
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

  func relaunchApp(at url: URL) async throws {
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

  func makeStagingDirectory(executionId: String) throws -> URL {
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

  func cleanupStagingDirectory(_ url: URL?) {
    guard let url else { return }
    try? FileManager.default.removeItem(at: url)
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

  func readInstalledVersion(at appURL: URL) -> String? {
    guard let bundle = Bundle(url: appURL) else { return nil }
    return bundle.infoDictionary?["CFBundleShortVersionString"] as? String
  }

  func recoveryAction(for error: Error) -> RecoveryAction? {
    guard let installError = error as? InstallError else { return nil }
    switch installError {
    case .privilegedHelperApprovalRequired:
      return .openSystemSettings
    default:
      return nil
    }
  }

  func helperSetupState(for error: Error) -> HelperSetupState? {
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

  func unmountDiskImage(at mountPoint: URL) async throws {
    _ = try await ProcessRunner.runSuccessful(
      "/usr/bin/hdiutil",
      arguments: ["detach", mountPoint.path]
    )
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

  func writePreparedPrivilegedOperation(
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
}
