import Foundation

nonisolated enum PrivilegedHelperConstants {
  static let serviceLabel = "com.jakejarvis.versioneer.PrivilegedHelper"
  static let launchDaemonPlistName = "com.jakejarvis.versioneer.PrivilegedHelper.plist"
  static let mainAppBundleIdentifier = "com.jakejarvis.versioneer"
  static let helperBundleIdentifier = "com.jakejarvis.versioneer.PrivilegedHelper"
  static let teamIdentifier = "B5ZWKBCUTU"
  static let mainAppCodeSigningRequirement =
    #"identifier "com.jakejarvis.versioneer" and anchor apple generic and certificate leaf[subject.OU] = "B5ZWKBCUTU""#
  static let helperCodeSigningRequirement =
    #"identifier "com.jakejarvis.versioneer.PrivilegedHelper" and anchor apple generic and certificate leaf[subject.OU] = "B5ZWKBCUTU""#
}

nonisolated enum PrivilegedOperationType: String, Codable, Sendable {
  case replaceApp = "replace_app"
  case installPackage = "install_package"
  case brewUpgrade = "brew_upgrade"
  case masUpgrade = "mas_upgrade"
}

/// Manifest written into the per-execution staging directory before elevation.
nonisolated struct PreparedPrivilegedOperation: Codable, Sendable {
  static let manifestFilename = "PreparedPrivilegedOperation.json"

  let executionId: String
  let operationType: PrivilegedOperationType
  let sourceRelativePath: String
  let sourceSHA256: String?
  let destinationPath: String
  let backupRelativePath: String?
  let installTarget: String?
  let caskToken: String?
  let masAppId: String?
  let masCliPath: String?

  init(
    executionId: String,
    operationType: PrivilegedOperationType,
    sourceRelativePath: String,
    sourceSHA256: String? = nil,
    destinationPath: String,
    backupRelativePath: String?,
    installTarget: String?,
    caskToken: String?,
    masAppId: String?,
    masCliPath: String?
  ) {
    self.executionId = executionId
    self.operationType = operationType
    self.sourceRelativePath = sourceRelativePath
    self.sourceSHA256 = sourceSHA256
    self.destinationPath = destinationPath
    self.backupRelativePath = backupRelativePath
    self.installTarget = installTarget
    self.caskToken = caskToken
    self.masAppId = masAppId
    self.masCliPath = masCliPath
  }

  static func manifestURL(in stagingDirectory: URL) -> URL {
    stagingDirectory.appendingPathComponent(manifestFilename)
  }

  func sourceURL(in stagingDirectory: URL) -> URL {
    stagingDirectory.appendingPathComponent(sourceRelativePath, isDirectory: true)
  }

  func backupURL(in stagingDirectory: URL) -> URL? {
    guard let backupRelativePath else { return nil }
    return stagingDirectory.appendingPathComponent(backupRelativePath, isDirectory: true)
  }
}

@objcMembers
nonisolated final class PrivilegedOperationRequest: NSObject, NSSecureCoding, @unchecked Sendable {
  static var supportsSecureCoding: Bool { true }

  let executionId: String
  let stagingDirectoryPath: String
  let manifestSHA256: String

  init(executionId: String, stagingDirectoryPath: String, manifestSHA256: String) {
    self.executionId = executionId
    self.stagingDirectoryPath = stagingDirectoryPath
    self.manifestSHA256 = manifestSHA256
  }

  required init?(coder: NSCoder) {
    guard let executionId = coder.decodeObject(of: NSString.self, forKey: "executionId") as String?,
      let stagingDirectoryPath = coder.decodeObject(
        of: NSString.self, forKey: "stagingDirectoryPath") as String?,
      let manifestSHA256 = coder.decodeObject(
        of: NSString.self, forKey: "manifestSHA256") as String?
    else {
      return nil
    }

    self.executionId = executionId
    self.stagingDirectoryPath = stagingDirectoryPath
    self.manifestSHA256 = manifestSHA256
  }

  func encode(with coder: NSCoder) {
    coder.encode(executionId as NSString, forKey: "executionId")
    coder.encode(stagingDirectoryPath as NSString, forKey: "stagingDirectoryPath")
    coder.encode(manifestSHA256 as NSString, forKey: "manifestSHA256")
  }
}

@objcMembers
nonisolated final class PrivilegedOperationResult: NSObject, NSSecureCoding, @unchecked Sendable {
  static var supportsSecureCoding: Bool { true }

  let operationTypeRawValue: String?
  let succeeded: Bool
  let detail: String
  let errorMessage: String?
  let usedRollback: Bool
  let output: String?

  var operationType: PrivilegedOperationType? {
    guard let operationTypeRawValue else { return nil }
    return PrivilegedOperationType(rawValue: operationTypeRawValue)
  }

  init(
    operationType: PrivilegedOperationType?,
    succeeded: Bool,
    detail: String,
    errorMessage: String? = nil,
    usedRollback: Bool = false,
    output: String? = nil
  ) {
    operationTypeRawValue = operationType?.rawValue
    self.succeeded = succeeded
    self.detail = detail
    self.errorMessage = errorMessage
    self.usedRollback = usedRollback
    self.output = output
  }

  required init?(coder: NSCoder) {
    operationTypeRawValue =
      coder.decodeObject(of: NSString.self, forKey: "operationTypeRawValue") as String?
    succeeded = coder.decodeBool(forKey: "succeeded")
    guard let detail = coder.decodeObject(of: NSString.self, forKey: "detail") as String? else {
      return nil
    }
    self.detail = detail
    errorMessage = coder.decodeObject(of: NSString.self, forKey: "errorMessage") as String?
    usedRollback = coder.decodeBool(forKey: "usedRollback")
    output = coder.decodeObject(of: NSString.self, forKey: "output") as String?
  }

  func encode(with coder: NSCoder) {
    coder.encode(operationTypeRawValue as NSString?, forKey: "operationTypeRawValue")
    coder.encode(succeeded, forKey: "succeeded")
    coder.encode(detail as NSString, forKey: "detail")
    coder.encode(errorMessage as NSString?, forKey: "errorMessage")
    coder.encode(usedRollback, forKey: "usedRollback")
    coder.encode(output as NSString?, forKey: "output")
  }
}

@objc protocol PrivilegedInstallerXPCProtocol {
  nonisolated func perform(
    _ request: PrivilegedOperationRequest,
    withReply reply: @escaping (PrivilegedOperationResult) -> Void
  )

  /// Lightweight liveness probe. The helper replies `true` if it is running.
  nonisolated func ping(withReply reply: @escaping (Bool) -> Void)
}
