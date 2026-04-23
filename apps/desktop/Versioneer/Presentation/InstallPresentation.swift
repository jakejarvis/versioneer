import Foundation

nonisolated struct InstallPresentation: Equatable, Sendable {
  enum Tone: String, Equatable, Sendable {
    case neutral
    case progress
    case success
    case warning
    case failure
  }

  nonisolated struct Banner: Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let detail: String
    let tone: Tone
  }

  nonisolated struct Progress: Equatable, Sendable {
    let currentStep: Int
    let totalSteps: Int
    let title: String
    let detail: String
  }

  let primaryActionTitle: String
  let primaryActionDisabled: Bool
  let tone: Tone
  let statusTitle: String?
  let statusDetail: String?
  let progress: Progress?
  let banners: [Banner]
  let trustSummary: [String]
  let recoveryAction: InstallCoordinator.RecoveryAction?

  @MainActor
  static func make(
    result: InventoryResult,
    state: InstallCoordinator.OperationState
  ) -> InstallPresentation {
    let progress = progressPresentation(for: state)
    let status = statusPresentation(for: state)
    return InstallPresentation(
      primaryActionTitle: primaryActionTitle(result: result, state: state),
      primaryActionDisabled: state.isRunning,
      tone: tone(for: state),
      statusTitle: status.title,
      statusDetail: status.detail,
      progress: progress,
      banners: banners(result: result, state: state),
      trustSummary: trustSummary(result: result),
      recoveryAction: state.recoveryAction
    )
  }

  @MainActor
  static func progressPresentation(
    for state: InstallCoordinator.OperationState
  ) -> Progress? {
    switch state.phase {
    case .preparing:
      Progress(currentStep: 1, totalSteps: 5, title: "Preparing Install", detail: state.detail)
    case .downloading:
      Progress(currentStep: 2, totalSteps: 5, title: "Downloading Update", detail: state.detail)
    case .verifying:
      Progress(currentStep: 3, totalSteps: 5, title: "Verifying Download", detail: state.detail)
    case .installing:
      Progress(currentStep: 4, totalSteps: 5, title: "Installing Update", detail: state.detail)
    case .relaunching:
      Progress(currentStep: 5, totalSteps: 5, title: "Relaunching App", detail: state.detail)
    case .idle, .completed, .failed:
      nil
    }
  }

  @MainActor
  private static func statusPresentation(
    for state: InstallCoordinator.OperationState
  ) -> (title: String?, detail: String?) {
    switch state.phase {
    case .idle:
      return (title: nil as String?, detail: nil as String?)
    case .completed:
      if let installedVersion = state.installedVersion {
        return ("Install Complete", "Detected version \(installedVersion).")
      }
      return ("Install Complete", "Versioneer finished the update flow.")
    case .failed:
      return ("Install Failed", state.errorMessage ?? state.detail)
    default:
      return (progressPresentation(for: state)?.title, state.detail)
    }
  }

  private static func tone(for state: InstallCoordinator.OperationState) -> Tone {
    switch state.phase {
    case .completed:
      .success
    case .failed:
      .failure
    case .preparing, .downloading, .verifying, .installing, .relaunching:
      .progress
    case .idle:
      .neutral
    }
  }

  private static func primaryActionTitle(
    result: InventoryResult,
    state: InstallCoordinator.OperationState
  ) -> String {
    switch state.phase {
    case .downloading:
      "Downloading…"
    case .verifying:
      "Verifying…"
    case .installing:
      "Installing…"
    case .relaunching:
      "Relaunching…"
    case .failed:
      "Retry Install"
    default:
      !result.isVerified ? "Install with Warning" : "Install Update"
    }
  }

  private static func banners(
    result: InventoryResult,
    state: InstallCoordinator.OperationState
  ) -> [Banner] {
    var banners: [Banner] = []

    if !result.isVerified {
      banners.append(
        Banner(
          id: "provisional",
          title: "Provisional Verification",
          detail:
            "Versioneer will still run full local verification before installing this update.",
          tone: .warning
        ))
    }

    if result.installStrategy?.requiresAdmin ?? false {
      banners.append(
        Banner(
          id: "admin",
          title: "Admin Access Required",
          detail:
            "This update needs Versioneer’s privileged helper to write into a protected location.",
          tone: .neutral
        ))
    }

    switch state.helperStatus {
    case .approvalRequired:
      banners.append(
        Banner(
          id: "helper-approval",
          title: "Approve Privileged Helper",
          detail: "Open System Settings and allow Versioneer’s helper before retrying the install.",
          tone: .warning
        ))
    case .unavailable, .failed:
      banners.append(
        Banner(
          id: "helper-error",
          title: "Privileged Helper Unavailable",
          detail: state.errorMessage ?? "Versioneer could not prepare its privileged helper.",
          tone: .failure
        ))
    case .preparing:
      banners.append(
        Banner(
          id: "helper-preparing",
          title: "Preparing Privileged Helper",
          detail: "Versioneer is setting up the helper required for this install.",
          tone: .progress
        ))
    case .notRegistered, .ready, .notNeeded, nil:
      break
    }

    return banners
  }

  private static func trustSummary(result: InventoryResult) -> [String] {
    var parts: [String] = []
    if let strategy = result.installStrategy {
      parts.append("Strategy: \(strategy.rawValue)")
    }
    if result.installStrategy?.requiresAdmin ?? false {
      parts.append("Admin authentication may be required")
    }
    if result.installStrategy?.requiresQuit ?? false {
      parts.append("The app will need to quit first")
    }
    if let artifact = result.artifact,
      let sizeBytes = artifact.sizeBytes
    {
      let formatter = ByteCountFormatter()
      formatter.countStyle = .file
      parts.append("Download: \(formatter.string(fromByteCount: Int64(sizeBytes)))")
    }
    return parts
  }
}
