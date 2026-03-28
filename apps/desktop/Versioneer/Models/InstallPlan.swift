import Foundation

/// Payload sent to `POST /v1/install/prepare`.
nonisolated struct InstallPrepareRequest: Codable, Sendable {
  let installId: String
  let snapshotId: String
  let matchedAppId: String
  let releaseId: String
  let installedVersion: String?
  let localAppPath: String
  let strategyCandidate: InstallStrategy
}

/// Response from `POST /v1/install/prepare`.
nonisolated struct InstallPrepareResponse: Codable, Sendable {
  let executionId: String
  let strategy: InstallStrategy
  let appId: String
  let releaseId: String
  let artifact: AppDecision.Artifact?
}

/// Payload sent to `POST /v1/install/executions/:executionId/status`.
nonisolated struct InstallExecutionStatusUpdate: Codable, Sendable {
  let installId: String
  let actionStatus: ActionStatus
  let clientVersionAfter: String?
  let errorMessage: String?
  let durationMs: Int?
  let detailsJson: String?

  enum ActionStatus: String, Codable, Sendable {
    case inProgress = "in_progress"
    case completed
    case failed
    case cancelled
  }
}
