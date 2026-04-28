import Darwin
import Foundation

nonisolated struct ValidatedPrivilegedOperation: Sendable {
  let executionId: String
  let stagingDirectory: URL
  let manifest: PreparedPrivilegedOperation
  let sourceURL: URL
  let destinationURL: URL?
  let backupURL: URL?
}

nonisolated enum PrivilegedOperationValidationError: LocalizedError {
  case invalidExecutionId
  case invalidStagingDirectory
  case stagingPathNotAllowed
  case manifestMissing
  case manifestInvalid
  case sourcePathInvalid(String)
  case destinationPathInvalid(String)
  case backupPathInvalid(String)
  case symlinkRejected(String)
  case unsupportedInstallTarget(String)
  case unsupportedOperation(String)
  case stagingDirectoryPermissionsInvalid(String)

  var errorDescription: String? {
    switch self {
    case .invalidExecutionId:
      "The privileged install request did not include a valid execution ID."
    case .invalidStagingDirectory:
      "The privileged install request pointed to an invalid staging directory."
    case .stagingPathNotAllowed:
      "The privileged install request used a staging directory outside Versioneer's allowed staging root."
    case .manifestMissing:
      "The privileged install manifest was missing from the staging directory."
    case .manifestInvalid:
      "The privileged install manifest was invalid."
    case .sourcePathInvalid(let message), .destinationPathInvalid(let message),
      .backupPathInvalid(let message):
      message
    case .symlinkRejected(let message):
      message
    case .unsupportedInstallTarget(let target):
      "Privileged package installs must target /. Received \(target)."
    case .unsupportedOperation(let message):
      message
    case .stagingDirectoryPermissionsInvalid(let message):
      message
    }
  }
}

nonisolated struct PrivilegedOperationValidator {
  let allowedStagingRoot: URL
  let allowedOwnerUserIdentifier: uid_t?
  let requireOwnerOnlyStaging: Bool
  private let executionIdRegex = try! NSRegularExpression(pattern: #"^[A-Za-z0-9._-]+$"#)

  init(
    allowedStagingRoot: URL,
    allowedOwnerUserIdentifier: uid_t? = nil,
    requireOwnerOnlyStaging: Bool = false
  ) {
    self.allowedStagingRoot = allowedStagingRoot
    self.allowedOwnerUserIdentifier = allowedOwnerUserIdentifier
    self.requireOwnerOnlyStaging = requireOwnerOnlyStaging
  }

  func validate(request: PrivilegedOperationRequest) throws -> ValidatedPrivilegedOperation {
    guard
      executionIdRegex.firstMatch(
        in: request.executionId,
        range: NSRange(request.executionId.startIndex..., in: request.executionId)
      ) != nil
    else {
      throw PrivilegedOperationValidationError.invalidExecutionId
    }

    let expectedStagingDirectory = allowedStagingRoot.appendingPathComponent(
      request.executionId, isDirectory: true)
    let requestedStagingDirectory = URL(fileURLWithPath: request.stagingDirectoryPath)
    let stagingDirectory = try canonicalizeExistingURL(
      requestedStagingDirectory,
      expectedDirectory: true,
      error: .invalidStagingDirectory
    )

    let allowedRoot = try canonicalizeExistingURL(
      allowedStagingRoot,
      expectedDirectory: true,
      error: .stagingPathNotAllowed
    )

    guard stagingDirectory.path == expectedStagingDirectory.standardizedFileURL.path,
      isDescendant(stagingDirectory, of: allowedRoot)
    else {
      throw PrivilegedOperationValidationError.stagingPathNotAllowed
    }

    try validateStagingDirectorySecurity(stagingDirectory)

    let manifestURL = PreparedPrivilegedOperation.manifestURL(in: stagingDirectory)
    let manifestData: Data
    do {
      manifestData = try Data(contentsOf: manifestURL)
    } catch {
      throw PrivilegedOperationValidationError.manifestMissing
    }

    let manifest: PreparedPrivilegedOperation
    do {
      manifest = try JSONDecoder().decode(PreparedPrivilegedOperation.self, from: manifestData)
    } catch {
      throw PrivilegedOperationValidationError.manifestInvalid
    }

    guard manifest.executionId == request.executionId else {
      throw PrivilegedOperationValidationError.manifestInvalid
    }
    switch manifest.operationType {
    case .brewUpgrade, .masUpgrade:
      throw PrivilegedOperationValidationError.unsupportedOperation(
        "Package-manager upgrades must run without the privileged helper.")
    case .replaceApp, .installPackage:
      break
    }

    let sourceURL: URL
    switch manifest.operationType {
    case .replaceApp, .installPackage:
      sourceURL = try validateRelativePath(
        manifest.sourceRelativePath,
        in: stagingDirectory,
        expectedExtension: manifest.operationType == .replaceApp ? "app" : "pkg",
        errorBuilder: PrivilegedOperationValidationError.sourcePathInvalid
      )
    case .brewUpgrade, .masUpgrade:
      sourceURL = stagingDirectory
    }

    let destinationURL: URL?
    switch manifest.operationType {
    case .replaceApp:
      destinationURL = try validateDestinationPath(
        manifest.destinationPath,
        operationType: manifest.operationType
      )
    case .installPackage:
      guard manifest.installTarget == "/", manifest.destinationPath == "/" else {
        throw PrivilegedOperationValidationError.unsupportedInstallTarget(
          manifest.installTarget ?? manifest.destinationPath)
      }
      destinationURL = URL(fileURLWithPath: "/")
    case .brewUpgrade, .masUpgrade:
      destinationURL = nil
    }

    let backupURL: URL?
    switch manifest.operationType {
    case .replaceApp:
      guard let destinationURL,
        let backupRelativePath = manifest.backupRelativePath
      else {
        throw PrivilegedOperationValidationError.backupPathInvalid(
          "Privileged app replacement requires a backup path inside the staging directory."
        )
      }
      let validatedBackupURL = try validateRelativePath(
        backupRelativePath,
        in: stagingDirectory,
        expectedExtension: "app",
        allowsMissingLeaf: true,
        errorBuilder: PrivilegedOperationValidationError.backupPathInvalid
      )
      guard validatedBackupURL.path != destinationURL.path else {
        throw PrivilegedOperationValidationError.backupPathInvalid(
          "The backup path must differ from the destination app path."
        )
      }
      backupURL = validatedBackupURL
    case .installPackage:
      guard manifest.installTarget == "/" else {
        throw PrivilegedOperationValidationError.unsupportedInstallTarget(
          manifest.installTarget ?? "")
      }
      backupURL = nil
    case .brewUpgrade, .masUpgrade:
      backupURL = nil
    }

    return ValidatedPrivilegedOperation(
      executionId: request.executionId,
      stagingDirectory: stagingDirectory,
      manifest: manifest,
      sourceURL: sourceURL,
      destinationURL: destinationURL,
      backupURL: backupURL
    )
  }

  private func validateRelativePath(
    _ relativePath: String,
    in stagingDirectory: URL,
    expectedExtension: String,
    allowsMissingLeaf: Bool = false,
    errorBuilder: (String) -> PrivilegedOperationValidationError
  ) throws -> URL {
    guard !relativePath.isEmpty,
      !relativePath.hasPrefix("/"),
      !relativePath.split(separator: "/").contains("..")
    else {
      throw errorBuilder(
        "The privileged install manifest contained an invalid relative source path.")
    }

    let absoluteURL = stagingDirectory.appendingPathComponent(relativePath, isDirectory: true)
    let canonicalURL = try canonicalizeURL(
      absoluteURL,
      expectedDirectory: expectedExtension == "app",
      allowsMissingLeaf: allowsMissingLeaf
    )

    guard isDescendant(canonicalURL, of: stagingDirectory) else {
      throw PrivilegedOperationValidationError.stagingPathNotAllowed
    }

    guard canonicalURL.pathExtension == expectedExtension else {
      throw errorBuilder(
        "The privileged install source must be a .\(expectedExtension) path inside staging.")
    }

    return canonicalURL
  }

  private func validateDestinationPath(
    _ destinationPath: String,
    operationType: PrivilegedOperationType
  ) throws -> URL {
    guard destinationPath.hasPrefix("/") else {
      throw PrivilegedOperationValidationError.destinationPathInvalid(
        "The privileged install destination path must be absolute."
      )
    }

    let destinationURL = URL(fileURLWithPath: destinationPath)
    guard operationType != .replaceApp || destinationURL.standardizedFileURL.pathExtension == "app"
    else {
      throw PrivilegedOperationValidationError.destinationPathInvalid(
        "Privileged app replacement destinations must end in .app."
      )
    }
    if operationType == .replaceApp {
      try rejectSymlinkedPathComponents(
        in: destinationURL.standardizedFileURL,
        allowsMissingLeaf: true
      )
      var isDirectory: ObjCBool = false
      guard FileManager.default.fileExists(atPath: destinationURL.path, isDirectory: &isDirectory),
        isDirectory.boolValue
      else {
        throw PrivilegedOperationValidationError.destinationPathInvalid(
          "Privileged app replacement destinations must be existing .app bundles."
        )
      }
    }

    let canonicalURL = try canonicalizeURL(
      destinationURL,
      expectedDirectory: operationType == .replaceApp,
      allowsMissingLeaf: operationType != .replaceApp
    )

    return canonicalURL
  }

  private func canonicalizeExistingURL(
    _ url: URL,
    expectedDirectory: Bool,
    error: PrivilegedOperationValidationError
  ) throws -> URL {
    do {
      return try canonicalizeURL(
        url, expectedDirectory: expectedDirectory, allowsMissingLeaf: false)
    } catch let validationError as PrivilegedOperationValidationError {
      throw validationError
    } catch {
      throw error
    }
  }

  private func validateStagingDirectorySecurity(_ stagingDirectory: URL) throws {
    guard requireOwnerOnlyStaging else { return }

    let attributes = try FileManager.default.attributesOfItem(atPath: stagingDirectory.path)
    if let allowedOwnerUserIdentifier,
      let owner = attributes[.ownerAccountID] as? NSNumber,
      owner.uint32Value != allowedOwnerUserIdentifier
    {
      throw PrivilegedOperationValidationError.stagingDirectoryPermissionsInvalid(
        "Privileged install staging must be owned by the requesting user.")
    }

    guard let permissions = attributes[.posixPermissions] as? NSNumber else {
      throw PrivilegedOperationValidationError.stagingDirectoryPermissionsInvalid(
        "Privileged install staging permissions could not be verified.")
    }

    let mode = permissions.uint16Value & 0o777
    guard mode & 0o077 == 0 else {
      throw PrivilegedOperationValidationError.stagingDirectoryPermissionsInvalid(
        "Privileged install staging must not be readable or writable by group or other users.")
    }
  }

  private func canonicalizeURL(
    _ url: URL,
    expectedDirectory: Bool,
    allowsMissingLeaf: Bool
  ) throws -> URL {
    let standardizedURL = url.standardizedFileURL
    try rejectSymlinkedPathComponents(in: standardizedURL, allowsMissingLeaf: allowsMissingLeaf)
    let resolvedURL = standardizedURL.resolvingSymlinksInPath()
    guard standardizedURL.path == resolvedURL.path else {
      throw PrivilegedOperationValidationError.symlinkRejected(
        "Privileged installs reject symlinked staging or destination paths."
      )
    }

    let fileManager = FileManager.default
    var isDirectory: ObjCBool = false
    if fileManager.fileExists(atPath: standardizedURL.path, isDirectory: &isDirectory) {
      guard isDirectory.boolValue == expectedDirectory else {
        throw
          (expectedDirectory
          ? PrivilegedOperationValidationError.sourcePathInvalid(
            "Expected a bundle directory at \(standardizedURL.path).")
          : PrivilegedOperationValidationError.sourcePathInvalid(
            "Expected a file at \(standardizedURL.path)."))
      }
    } else if !allowsMissingLeaf {
      throw PrivilegedOperationValidationError.sourcePathInvalid(
        "Expected an existing path at \(standardizedURL.path).")
    } else {
      let parentURL = standardizedURL.deletingLastPathComponent()
      var parentIsDirectory: ObjCBool = false
      guard fileManager.fileExists(atPath: parentURL.path, isDirectory: &parentIsDirectory),
        parentIsDirectory.boolValue
      else {
        throw PrivilegedOperationValidationError.destinationPathInvalid(
          "The destination parent directory does not exist."
        )
      }
    }

    return standardizedURL
  }

  private func rejectSymlinkedPathComponents(in url: URL, allowsMissingLeaf: Bool) throws {
    let pathComponents = url.pathComponents
    guard !pathComponents.isEmpty else {
      return
    }

    var currentURL = URL(fileURLWithPath: pathComponents[0], isDirectory: true)
    for (index, component) in pathComponents.enumerated() where index > 0 {
      currentURL.appendPathComponent(component, isDirectory: true)

      do {
        let resourceValues = try currentURL.resourceValues(forKeys: [.isSymbolicLinkKey])
        if resourceValues.isSymbolicLink == true,
          !isAllowedSystemAlias(currentURL)
        {
          throw PrivilegedOperationValidationError.symlinkRejected(
            "Privileged installs reject symlinked staging or destination paths."
          )
        }
      } catch {
        let nsError = error as NSError
        if allowsMissingLeaf,
          index == pathComponents.index(before: pathComponents.endIndex),
          nsError.domain == NSCocoaErrorDomain,
          nsError.code == NSFileReadNoSuchFileError
        {
          break
        }

        throw error
      }
    }
  }

  private func isAllowedSystemAlias(_ url: URL) -> Bool {
    switch url.standardizedFileURL.path {
    case "/var", "/tmp":
      true
    default:
      false
    }
  }

  private func isDescendant(_ candidate: URL, of root: URL) -> Bool {
    let rootPath = root.standardizedFileURL.path
    let candidatePath = candidate.standardizedFileURL.path
    return candidatePath == rootPath || candidatePath.hasPrefix(rootPath + "/")
  }
}
