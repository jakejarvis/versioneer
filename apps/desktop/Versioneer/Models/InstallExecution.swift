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

nonisolated struct InstallExecutionCreateRequest: Codable, Sendable {
  let client: InventoryCheckRequest.ClientInfo
  let target: Target
  let install: Install
  let expected: Expected

  struct Target: Codable, Sendable {
    let appId: String
    let releaseId: String
    let artifactId: String?
    let targetArchitecture: String?
    let channel: String?
  }

  struct Install: Codable, Sendable {
    let strategy: String
    let executionRoute: String
  }

  struct Expected: Codable, Sendable {
    let previousVersion: String?
    let bundleId: String?
    let teamId: String?
  }
}

nonisolated struct InstallExecutionCreateResponse: Codable, Sendable {
  let execution: Execution

  struct Execution: Codable, Sendable {
    let id: String
    let status: String
  }
}

nonisolated struct InstallExecutionEventRequest: Codable, Sendable {
  let event: Event
  let verification: InstallVerificationSummary?

  struct Event: Codable, Sendable {
    let status: String
    let installedVersion: String?
    let errorMessage: String?
  }
}

nonisolated struct InstallExecutionEventResponse: Codable, Sendable {
  let execution: InstallExecutionCreateResponse.Execution
}
