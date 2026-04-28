import Darwin
import Foundation
import Testing

@testable import Versioneer

struct PrivilegedOperationValidationTests {
  @Test func rejectsInvalidExecutionIds() throws {
    let sandbox = try TestSandbox()
    try sandbox.createDirectory(at: sandbox.allowedStagingRoot)

    let request = PrivilegedOperationRequest(
      executionId: "../bad",
      stagingDirectoryPath: sandbox.allowedStagingRoot.appendingPathComponent("exec_bad").path,
      manifestSHA256: placeholderManifestSHA256
    )

    do {
      _ = try sandbox.validator.validate(request: request)
      Issue.record("Expected invalid execution ID failure")
    } catch let error as PrivilegedOperationValidationError {
      guard case .invalidExecutionId = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func rejectsStagingOutsideAllowedRoot() throws {
    let sandbox = try TestSandbox()
    try sandbox.createDirectory(at: sandbox.allowedStagingRoot)
    let externalStaging = sandbox.root.appendingPathComponent(
      "elsewhere/exec_test", isDirectory: true)
    try sandbox.createDirectory(at: externalStaging)

    let request = PrivilegedOperationRequest(
      executionId: "exec_test",
      stagingDirectoryPath: externalStaging.path,
      manifestSHA256: placeholderManifestSHA256
    )

    do {
      _ = try sandbox.validator.validate(request: request)
      Issue.record("Expected staging path rejection")
    } catch let error as PrivilegedOperationValidationError {
      guard case .stagingPathNotAllowed = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func rejectsSymlinkedDestinationPaths() throws {
    let sandbox = try TestSandbox()
    let context = try sandbox.makeReplaceContext(executionId: "exec_symlink")
    let realAppsDirectory = sandbox.root.appendingPathComponent("RealApps", isDirectory: true)
    let symlinkedAppsDirectory = sandbox.root.appendingPathComponent(
      "LinkedApps", isDirectory: true)
    try sandbox.createDirectory(at: realAppsDirectory)
    try FileManager.default.createSymbolicLink(
      at: symlinkedAppsDirectory, withDestinationURL: realAppsDirectory)

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_symlink",
      operationType: .replaceApp,
      sourceRelativePath: "payload/Test.app",
      destinationPath: symlinkedAppsDirectory.appendingPathComponent("Test.app").path,
      backupRelativePath: "backup/Test.app",
      installTarget: nil,
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(manifest, to: context.stagingDirectory)

    do {
      _ = try sandbox.validator.validate(request: context.request)
      Issue.record("Expected symlink rejection")
    } catch let error as PrivilegedOperationValidationError {
      guard case .symlinkRejected = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func rejectsSymlinkedStagingPaths() throws {
    let sandbox = try TestSandbox()
    let context = try sandbox.makePackageContext(executionId: "exec_staging_symlink")
    let symlinkedStagingRoot = sandbox.root.appendingPathComponent(
      "LinkedInstallStaging", isDirectory: true)
    try FileManager.default.createSymbolicLink(
      at: symlinkedStagingRoot, withDestinationURL: sandbox.allowedStagingRoot)

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_staging_symlink",
      operationType: .installPackage,
      sourceRelativePath: "payload/payload.pkg",
      destinationPath: "/",
      backupRelativePath: nil,
      installTarget: "/",
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(manifest, to: context.stagingDirectory)

    let request = PrivilegedOperationRequest(
      executionId: "exec_staging_symlink",
      stagingDirectoryPath: symlinkedStagingRoot.appendingPathComponent(
        "exec_staging_symlink", isDirectory: true
      ).path,
      manifestSHA256: placeholderManifestSHA256
    )

    do {
      _ = try sandbox.validator.validate(request: request)
      Issue.record("Expected symlink rejection")
    } catch let error as PrivilegedOperationValidationError {
      guard case .symlinkRejected = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func rejectsReplaceSourcesThatAreNotAppBundles() throws {
    let sandbox = try TestSandbox()
    let context = try sandbox.makeReplaceContext(
      executionId: "exec_bad_source", sourceName: "Test.pkg")

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_bad_source",
      operationType: .replaceApp,
      sourceRelativePath: "payload/Test.pkg",
      destinationPath: sandbox.root.appendingPathComponent("Applications/Test.app").path,
      backupRelativePath: "backup/Test.app",
      installTarget: nil,
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(manifest, to: context.stagingDirectory)

    do {
      _ = try sandbox.validator.validate(request: context.request)
      Issue.record("Expected invalid replace source failure")
    } catch let error as PrivilegedOperationValidationError {
      guard case .sourcePathInvalid = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func rejectsReplaceDestinationsThatAreNotAppBundles() throws {
    let sandbox = try TestSandbox()
    let context = try sandbox.makeReplaceContext(executionId: "exec_bad_destination")
    let destinationParent = sandbox.root.appendingPathComponent("Applications", isDirectory: true)
    try sandbox.createDirectory(at: destinationParent)

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_bad_destination",
      operationType: .replaceApp,
      sourceRelativePath: "payload/Test.app",
      destinationPath: destinationParent.appendingPathComponent("Test").path,
      backupRelativePath: "backup/Test.app",
      installTarget: nil,
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(manifest, to: context.stagingDirectory)

    do {
      _ = try sandbox.validator.validate(request: context.request)
      Issue.record("Expected invalid replace destination failure")
    } catch let error as PrivilegedOperationValidationError {
      guard case .destinationPathInvalid = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func rejectsReplaceDestinationsThatDoNotExist() throws {
    let sandbox = try TestSandbox()
    let context = try sandbox.makeReplaceContext(executionId: "exec_missing_destination")
    let destinationParent = sandbox.root.appendingPathComponent("Applications", isDirectory: true)
    try sandbox.createDirectory(at: destinationParent)

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_missing_destination",
      operationType: .replaceApp,
      sourceRelativePath: "payload/Test.app",
      destinationPath: destinationParent.appendingPathComponent("Missing.app").path,
      backupRelativePath: "backup/Missing.app",
      installTarget: nil,
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(manifest, to: context.stagingDirectory)

    do {
      _ = try sandbox.validator.validate(request: context.request)
      Issue.record("Expected missing replace destination failure")
    } catch let error as PrivilegedOperationValidationError {
      guard case .destinationPathInvalid = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func rejectsPackageSourcesThatAreNotPackages() throws {
    let sandbox = try TestSandbox()
    let context = try sandbox.makePackageContext(
      executionId: "exec_bad_pkg", packageName: "payload.zip")

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_bad_pkg",
      operationType: .installPackage,
      sourceRelativePath: "payload/payload.zip",
      destinationPath: "/",
      backupRelativePath: nil,
      installTarget: "/",
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(manifest, to: context.stagingDirectory)

    do {
      _ = try sandbox.validator.validate(request: context.request)
      Issue.record("Expected invalid package source failure")
    } catch let error as PrivilegedOperationValidationError {
      guard case .sourcePathInvalid = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func rejectsPackageTargetsOtherThanRoot() throws {
    let sandbox = try TestSandbox()
    let context = try sandbox.makePackageContext(executionId: "exec_wrong_target")

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_wrong_target",
      operationType: .installPackage,
      sourceRelativePath: "payload/payload.pkg",
      destinationPath: "/Applications",
      backupRelativePath: nil,
      installTarget: "/Applications",
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(manifest, to: context.stagingDirectory)

    do {
      _ = try sandbox.validator.validate(request: context.request)
      Issue.record("Expected wrong install target failure")
    } catch let error as PrivilegedOperationValidationError {
      guard case .unsupportedInstallTarget = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func rejectsGroupWritableStagingWhenOwnerOnlyModeIsRequired() throws {
    let sandbox = try TestSandbox(requireOwnerOnlyStaging: true)
    let context = try sandbox.makePackageContext(executionId: "exec_open_staging")
    try FileManager.default.setAttributes(
      [.posixPermissions: 0o755], ofItemAtPath: context.stagingDirectory.path)

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_open_staging",
      operationType: .installPackage,
      sourceRelativePath: "payload/payload.pkg",
      destinationPath: "/",
      backupRelativePath: nil,
      installTarget: "/",
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(manifest, to: context.stagingDirectory)

    do {
      _ = try sandbox.validator.validate(request: context.request)
      Issue.record("Expected owner-only staging permission failure")
    } catch let error as PrivilegedOperationValidationError {
      guard case .stagingDirectoryPermissionsInvalid = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func acceptsPreparedPackageWhenManifestAndSourceDigestsMatch() throws {
    let sandbox = try TestSandbox()
    let context = try sandbox.makePackageContext(executionId: "exec_valid_pkg")
    let packageURL = context.stagingDirectory.appendingPathComponent("payload/payload.pkg")
    let sourceSHA256 = try PrivilegedOperationDigest.sourceSHA256(at: packageURL)

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_valid_pkg",
      operationType: .installPackage,
      sourceRelativePath: "payload/payload.pkg",
      sourceSHA256: sourceSHA256,
      destinationPath: "/",
      backupRelativePath: nil,
      installTarget: "/",
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(manifest, to: context.stagingDirectory)

    let request = try sandbox.request(
      executionId: "exec_valid_pkg",
      stagingDirectory: context.stagingDirectory
    )
    let validatedOperation = try sandbox.validator.validate(request: request)

    #expect(validatedOperation.sourceURL.path == packageURL.path)
    #expect(validatedOperation.manifest.sourceSHA256 == sourceSHA256)
  }

  @Test func rejectsManifestMutationAfterRequestIsTrusted() throws {
    let sandbox = try TestSandbox()
    let context = try sandbox.makePackageContext(executionId: "exec_manifest_mutation")
    let packageURL = context.stagingDirectory.appendingPathComponent("payload/payload.pkg")
    let sourceSHA256 = try PrivilegedOperationDigest.sourceSHA256(at: packageURL)

    let trustedManifest = PreparedPrivilegedOperation(
      executionId: "exec_manifest_mutation",
      operationType: .installPackage,
      sourceRelativePath: "payload/payload.pkg",
      sourceSHA256: sourceSHA256,
      destinationPath: "/",
      backupRelativePath: nil,
      installTarget: "/",
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(trustedManifest, to: context.stagingDirectory)
    let request = try sandbox.request(
      executionId: "exec_manifest_mutation",
      stagingDirectory: context.stagingDirectory
    )

    let mutatedManifest = PreparedPrivilegedOperation(
      executionId: "exec_manifest_mutation",
      operationType: .installPackage,
      sourceRelativePath: "payload/payload.pkg",
      sourceSHA256: sourceSHA256,
      destinationPath: "/",
      backupRelativePath: nil,
      installTarget: "/",
      caskToken: "mutated-after-request",
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(mutatedManifest, to: context.stagingDirectory)

    do {
      _ = try sandbox.validator.validate(request: request)
      Issue.record("Expected manifest digest mismatch")
    } catch let error as PrivilegedOperationValidationError {
      guard case .manifestHashMismatch = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func rejectsSourceMutationAfterManifestIsTrusted() throws {
    let sandbox = try TestSandbox()
    let context = try sandbox.makeReplaceContext(executionId: "exec_source_mutation")
    let sourceURL = context.stagingDirectory.appendingPathComponent(
      "payload/Test.app", isDirectory: true)
    let destinationURL = sandbox.root
      .appendingPathComponent("Applications", isDirectory: true)
      .appendingPathComponent("Test.app", isDirectory: true)
    try sandbox.createDirectory(at: destinationURL)
    try sandbox.createDirectory(
      at: context.stagingDirectory.appendingPathComponent("backup", isDirectory: true))

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_source_mutation",
      operationType: .replaceApp,
      sourceRelativePath: "payload/Test.app",
      sourceSHA256: try PrivilegedOperationDigest.sourceSHA256(at: sourceURL),
      destinationPath: destinationURL.path,
      backupRelativePath: "backup/Test.app",
      installTarget: nil,
      caskToken: nil,
      masAppId: nil,
      masCliPath: nil
    )
    try sandbox.writeManifest(manifest, to: context.stagingDirectory)
    let request = try sandbox.request(
      executionId: "exec_source_mutation",
      stagingDirectory: context.stagingDirectory
    )

    let contentsURL = sourceURL.appendingPathComponent("Contents", isDirectory: true)
    try sandbox.createDirectory(at: contentsURL)
    try Data("mutated".utf8).write(to: contentsURL.appendingPathComponent("Info.plist"))

    do {
      _ = try sandbox.validator.validate(request: request)
      Issue.record("Expected source digest mismatch")
    } catch let error as PrivilegedOperationValidationError {
      guard case .sourceDigestMismatch = error else {
        Issue.record("Unexpected validation error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func packageManagerUpgradeManifestsAreRejectedByPrivilegedHelper() throws {
    let sandbox = try TestSandbox()

    for operationType in [PrivilegedOperationType.brewUpgrade, .masUpgrade] {
      let executionId = "exec_\(operationType.rawValue)"
      let stagingDirectory = sandbox.allowedStagingRoot.appendingPathComponent(
        executionId, isDirectory: true)
      try sandbox.createDirectory(at: stagingDirectory)

      let manifest = PreparedPrivilegedOperation(
        executionId: executionId,
        operationType: operationType,
        sourceRelativePath: ".",
        destinationPath: "",
        backupRelativePath: nil,
        installTarget: nil,
        caskToken: "firefox",
        masAppId: "497799835",
        masCliPath: "/opt/homebrew/bin/mas"
      )
      try sandbox.writeManifest(manifest, to: stagingDirectory)

      let request = PrivilegedOperationRequest(
        executionId: executionId,
        stagingDirectoryPath: stagingDirectory.path,
        manifestSHA256: placeholderManifestSHA256
      )

      do {
        _ = try sandbox.validator.validate(request: request)
        Issue.record("Expected package-manager operation to be rejected")
      } catch let error as PrivilegedOperationValidationError {
        guard case .unsupportedOperation = error else {
          Issue.record("Unexpected validation error: \(error.localizedDescription)")
          return
        }
      } catch {
        Issue.record("Unexpected error: \(error.localizedDescription)")
      }
    }
  }
}

private struct TestSandbox {
  let root: URL
  let allowedStagingRoot: URL
  let validator: PrivilegedOperationValidator

  init(requireOwnerOnlyStaging: Bool = false) throws {
    root = FileManager.default.temporaryDirectory
      .resolvingSymlinksInPath()
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    allowedStagingRoot = PrivilegedInstallPaths.stagingRoot(in: root)
    validator = PrivilegedOperationValidator(
      allowedStagingRoot: allowedStagingRoot,
      allowedOwnerUserIdentifier: getuid(),
      requireOwnerOnlyStaging: requireOwnerOnlyStaging
    )
    try createDirectory(at: root)
  }

  func createDirectory(at url: URL) throws {
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
  }

  func makeReplaceContext(
    executionId: String,
    sourceName: String = "Test.app"
  ) throws -> (stagingDirectory: URL, request: PrivilegedOperationRequest) {
    let stagingDirectory = allowedStagingRoot.appendingPathComponent(executionId, isDirectory: true)
    let payloadDirectory = stagingDirectory.appendingPathComponent("payload", isDirectory: true)
    try createDirectory(at: payloadDirectory)

    let sourceURL = payloadDirectory.appendingPathComponent(
      sourceName, isDirectory: sourceName.hasSuffix(".app"))
    if sourceName.hasSuffix(".app") {
      try createDirectory(at: sourceURL)
    } else {
      FileManager.default.createFile(atPath: sourceURL.path, contents: Data(), attributes: nil)
    }

    let request = PrivilegedOperationRequest(
      executionId: executionId,
      stagingDirectoryPath: stagingDirectory.path,
      manifestSHA256: placeholderManifestSHA256
    )
    return (stagingDirectory, request)
  }

  func makePackageContext(
    executionId: String,
    packageName: String = "payload.pkg"
  ) throws -> (stagingDirectory: URL, request: PrivilegedOperationRequest) {
    let stagingDirectory = allowedStagingRoot.appendingPathComponent(executionId, isDirectory: true)
    let payloadDirectory = stagingDirectory.appendingPathComponent("payload", isDirectory: true)
    try createDirectory(at: payloadDirectory)

    let packageURL = payloadDirectory.appendingPathComponent(packageName)
    FileManager.default.createFile(atPath: packageURL.path, contents: Data(), attributes: nil)

    let request = PrivilegedOperationRequest(
      executionId: executionId,
      stagingDirectoryPath: stagingDirectory.path,
      manifestSHA256: placeholderManifestSHA256
    )
    return (stagingDirectory, request)
  }

  func writeManifest(_ manifest: PreparedPrivilegedOperation, to stagingDirectory: URL) throws {
    let data = try JSONEncoder().encode(manifest)
    try data.write(
      to: PreparedPrivilegedOperation.manifestURL(in: stagingDirectory), options: [.atomic])
  }

  func request(executionId: String, stagingDirectory: URL) throws -> PrivilegedOperationRequest {
    PrivilegedOperationRequest(
      executionId: executionId,
      stagingDirectoryPath: stagingDirectory.path,
      manifestSHA256: try PrivilegedOperationDigest.sha256Hex(
        forFileAt: PreparedPrivilegedOperation.manifestURL(in: stagingDirectory))
    )
  }
}

private let placeholderManifestSHA256 = String(repeating: "0", count: 64)
