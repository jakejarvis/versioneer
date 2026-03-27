import Foundation

nonisolated struct FloatingBarPresentation: Equatable, Sendable {
  enum Mode: Equatable, Sendable {
    case idle
    case scanning(detail: String)
    case submitting(detail: String)
    case updates(count: Int)
    case selection(count: Int, updatableCount: Int)
    case installing(appName: String, phase: String)
    case error(message: String)
  }

  let mode: Mode

  var isVisible: Bool {
    switch mode {
    case .idle:
      false
    default:
      true
    }
  }

  @MainActor
  static func make(
    loadState: AppState.LoadState,
    scanSummary: AppState.ScanSummary,
    selectedIDs: Set<String>,
    updatableResults: [AppDecision],
    activeInstall: InstallCoordinator.OperationState?
  ) -> FloatingBarPresentation {
    // Active scan/submit takes priority
    switch loadState {
    case .scanning:
      return FloatingBarPresentation(mode: .scanning(detail: "Discovering installed apps…"))
    case .submitting:
      return FloatingBarPresentation(
        mode: .submitting(
          detail: "Checking \(scanSummary.totalApps) apps for updates…"
        ))
    case .error(let message):
      return FloatingBarPresentation(mode: .error(message: message))
    case .idle, .done:
      break
    }

    // Active install
    if let activeInstall, activeInstall.isRunning {
      return FloatingBarPresentation(
        mode: .installing(
          appName: activeInstall.appDisplayName ?? "App",
          phase: activeInstall.phase.rawValue.capitalized
        ))
    }

    // Multi-select
    if !selectedIDs.isEmpty {
      let updatableCount = updatableResults.filter { selectedIDs.contains($0.id) }.count
      return FloatingBarPresentation(
        mode: .selection(
          count: selectedIDs.count,
          updatableCount: updatableCount
        ))
    }

    // Updates available
    let updateCount = scanSummary.updatesAvailableCount
    if updateCount > 0 {
      return FloatingBarPresentation(mode: .updates(count: updateCount))
    }

    return FloatingBarPresentation(mode: .idle)
  }
}
