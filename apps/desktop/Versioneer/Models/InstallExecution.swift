import Foundation

nonisolated struct InstallVerificationSummary: Codable, Sendable {
  let strategy: String
  var executionRoute: String? = nil
  var hashVerified: Bool? = nil
  var signatureVerified: Bool? = nil
  var notarizationVerified: Bool? = nil
  var bundleIdMatch: Bool? = nil
  var teamIdMatch: Bool? = nil
  var versionMatch: Bool? = nil
  var observedBundleId: String? = nil
  var observedTeamId: String? = nil
  var observedVersion: String? = nil
}

nonisolated struct InstallPrepareRequest: Codable, Sendable {
  let client: InventoryCheckRequest.ClientInfo
  let appId: String
  let releaseId: String
  let artifactId: String?
  let targetArchitecture: String?
  let installStrategy: String
  let executionRoute: String?
  let channel: String?
  let previousVersion: String?
  let bundleId: String?
  let teamId: String?
}

nonisolated struct InstallPrepareResponse: Codable, Sendable {
  let executionId: String
  let status: String
}

nonisolated struct InstallExecutionStatusRequest: Codable, Sendable {
  let client: InventoryCheckRequest.ClientInfo
  let appId: String
  let releaseId: String
  let artifactId: String?
  let targetArchitecture: String?
  let installStrategy: String
  let executionRoute: String?
  let channel: String?
  let previousVersion: String?
  let installedVersion: String?
  let bundleId: String?
  let teamId: String?
  let status: String
  let errorMessage: String?
  let verification: InstallVerificationSummary?
}

nonisolated struct InstallExecutionStatusResponse: Codable, Sendable {
  let executionId: String
  let status: String
}
