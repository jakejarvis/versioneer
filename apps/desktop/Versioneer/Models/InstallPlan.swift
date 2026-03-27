import Foundation

/// Payload sent to `POST /v1/install/prepare`.
nonisolated struct InstallPrepareRequest: Codable, Sendable {
  let installId: String
  let snapshotId: String
  let matchedAppId: String
  let releaseId: String
  let installedVersion: String?
  let localAppPath: String
  let strategyCandidate: AppDecision.Install.Strategy
}

/// Response from `POST /v1/install/prepare`.
nonisolated struct InstallPrepareResponse: Codable, Sendable {
  let executionId: String
  let plan: InstallPlan
}

/// Server-issued install plan the desktop app executes.
nonisolated struct InstallPlan: Codable, Sendable {
  let executionId: String
  let appId: String
  let releaseId: String
  let strategy: AppDecision.Install.Strategy
  let installabilityClass: AppDecision.Install.InstallabilityClass
  let warningLevel: WarningLevel
  let requiresQuit: Bool
  let requiresAdmin: Bool
  let supportsSilent: Bool
  let relaunchAfterInstall: Bool
  let artifact: AppDecision.Artifact?
  let localVerification: LocalVerificationChecks

  enum WarningLevel: String, Codable, Sendable {
    case none
    case provisional
  }

  struct LocalVerificationChecks: Codable, Sendable {
    let requireHash: Bool
    let requireSignature: Bool
    let requireNotarization: Bool
    let requireBundleIdMatch: Bool
    let requireTeamIdMatch: Bool
    let requireVersionMatch: Bool
  }
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
