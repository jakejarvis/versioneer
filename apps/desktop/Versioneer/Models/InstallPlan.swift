import Foundation

/// Resolved install plan derived from an AppDecision.
/// Replaces the old server-issued InstallPrepareResponse.
nonisolated struct InstallPlan: Sendable {
  let localId: String
  let strategy: InstallStrategy
  let appId: String
  let releaseId: String
  let channel: String?
  let artifact: AppDecision.Artifact?

  init(
    localId: String = UUID().uuidString,
    strategy: InstallStrategy,
    appId: String,
    releaseId: String,
    channel: String? = nil,
    artifact: AppDecision.Artifact? = nil
  ) {
    self.localId = localId
    self.strategy = strategy
    self.appId = appId
    self.releaseId = releaseId
    self.channel = channel
    self.artifact = artifact
  }

  init?(result: AppDecision) {
    guard let strategy = result.installStrategy,
      let appId = result.matchedAppId,
      let releaseId = result.latestReleaseId
    else { return nil }

    self.localId = UUID().uuidString
    self.strategy = strategy
    self.appId = appId
    self.releaseId = releaseId
    self.channel = result.channel
    self.artifact = result.artifact
  }
}
