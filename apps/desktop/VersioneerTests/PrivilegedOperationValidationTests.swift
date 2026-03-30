import Foundation
import Testing

@testable import Versioneer

struct PrivilegedOperationValidationTests {
  @Test func rejectsInvalidExecutionIds() throws {
    let sandbox = try TestSandbox()
    try sandbox.createDirectory(at: sandbox.allowedStagingRoot)

    let request = PrivilegedOperationRequest(
      executionId: "../bad",
      stagingDirectoryPath: sandbox.allowedStagingRoot.appendingPathComponent("exec_bad").path
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
      stagingDirectoryPath: externalStaging.path
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
      ).path
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
  @Test func masUpgradeManifestPassesValidation() throws {
    let sandbox = try TestSandbox()
    let stagingDirectory = sandbox.allowedStagingRoot.appendingPathComponent(
      "exec_mas", isDirectory: true)
    try sandbox.createDirectory(at: stagingDirectory)

    let manifest = PreparedPrivilegedOperation(
      executionId: "exec_mas",
      operationType: .masUpgrade,
      sourceRelativePath: ".",
      destinationPath: "",
      backupRelativePath: nil,
      installTarget: nil,
      caskToken: nil,
      masAppId: "497799835",
      masCliPath: "/opt/homebrew/bin/mas"
    )
    try sandbox.writeManifest(manifest, to: stagingDirectory)

    let request = PrivilegedOperationRequest(
      executionId: "exec_mas",
      stagingDirectoryPath: stagingDirectory.path
    )

    let validated = try sandbox.validator.validate(request: request)
    #expect(validated.manifest.operationType == .masUpgrade)
    #expect(validated.manifest.masAppId == "497799835")
    #expect(validated.manifest.masCliPath == "/opt/homebrew/bin/mas")
    #expect(validated.destinationURL == nil)
    #expect(validated.backupURL == nil)
  }
}

private struct TestSandbox {
  let root: URL
  let allowedStagingRoot: URL
  let validator: PrivilegedOperationValidator

  init() throws {
    root = FileManager.default.temporaryDirectory
      .resolvingSymlinksInPath()
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    allowedStagingRoot = PrivilegedInstallPaths.stagingRoot(in: root)
    validator = PrivilegedOperationValidator(allowedStagingRoot: allowedStagingRoot)
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
      stagingDirectoryPath: stagingDirectory.path
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
      stagingDirectoryPath: stagingDirectory.path
    )
    return (stagingDirectory, request)
  }

  func writeManifest(_ manifest: PreparedPrivilegedOperation, to stagingDirectory: URL) throws {
    let data = try JSONEncoder().encode(manifest)
    try data.write(
      to: PreparedPrivilegedOperation.manifestURL(in: stagingDirectory), options: [.atomic])
  }
}
