import Foundation

nonisolated struct StatusBarPresentation: Equatable, Sendable {
  let lastCheckedText: String
  let appCountText: String
  let isScanning: Bool

  @MainActor
  static func make(
    summary: AppState.ScanSummary,
    loadState: AppState.LoadState
  ) -> StatusBarPresentation {
    let lastChecked: String =
      if let date = summary.lastCompletedAt {
        abs(date.timeIntervalSinceNow) < 5
          ? "just now"
          : RelativeDateFormatter.shared.localizedString(for: date, relativeTo: Date())
      } else {
        "Never"
      }

    let appCount = "\(summary.totalApps) app\(summary.totalApps == 1 ? "" : "s")"

    let isScanning = loadState == .scanning || loadState == .submitting

    return StatusBarPresentation(
      lastCheckedText: lastChecked,
      appCountText: appCount,
      isScanning: isScanning
    )
  }
}

private enum RelativeDateFormatter {
  static let shared: RelativeDateTimeFormatter = {
    let formatter = RelativeDateTimeFormatter()
    formatter.unitsStyle = .abbreviated
    return formatter
  }()
}
