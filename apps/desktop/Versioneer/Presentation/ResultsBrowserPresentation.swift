import Foundation

nonisolated enum ResultsBrowserSort: String, CaseIterable, Identifiable, Sendable {
  case updatesFirst
  case name
  case latestVersion
  case releasedDate

  var id: String { rawValue }

  var title: String {
    switch self {
    case .updatesFirst:
      "Updates First"
    case .name:
      "Name"
    case .latestVersion:
      "Latest Version"
    case .releasedDate:
      "Release Date"
    }
  }
}

nonisolated struct ResultsBrowserRowPresentation: Identifiable, Sendable {
  enum Tone: String, Sendable {
    case accent
    case positive
    case attention
    case error
    case neutral
  }

  let id: String
  let appName: String
  let secondaryText: String?
  let statusText: String
  let statusTone: Tone
  let statusSystemImage: String
  let installedVersionText: String
  let latestVersionText: String
  let releasedDateText: String
  let isUpdateAvailable: Bool
  let canInstall: Bool
  let versionDiffText: String?
  let defaultSortRank: Int
  let latestVersionSortKey: String
  let releasedAtSortDate: Date?

  static func make(
    result: AppDecision,
    installState: InstallCoordinator.OperationState
  ) -> ResultsBrowserRowPresentation {
    let status = statusPresentation(result: result, installState: installState)
    let isUpdate = result.decision == .updateAvailable && installState.phase == .idle
    let versionDiff: String? =
      if isUpdate,
        let installed = result.installedVersion,
        let latest = result.latestVersion
      {
        "\(VersionFormatting.displayVersion(installed)) → \(VersionFormatting.displayVersion(latest))"
      } else {
        nil
      }
    return ResultsBrowserRowPresentation(
      id: result.id,
      appName: result.matchedAppName ?? result.appName,
      secondaryText: result.bundleId ?? result.appName,
      statusText: status.text,
      statusTone: status.tone,
      statusSystemImage: status.systemImage,
      installedVersionText: VersionFormatting.displayVersion(result.installedVersion),
      latestVersionText: VersionFormatting.displayVersion(result.latestVersion),
      releasedDateText: VersionFormatting.relativeDate(from: result.releasedAt),
      isUpdateAvailable: isUpdate,
      canInstall: result.install.canInstall && installState.phase == .idle,
      versionDiffText: versionDiff,
      defaultSortRank: defaultSortRank(result: result, installState: installState),
      latestVersionSortKey: result.latestVersionRaw ?? result.latestVersion ?? "",
      releasedAtSortDate: ResultsBrowserDateParser.date(from: result.releasedAt)
    )
  }

  private static func statusPresentation(
    result: AppDecision,
    installState: InstallCoordinator.OperationState
  ) -> (text: String, tone: Tone, systemImage: String) {
    switch installState.phase {
    case .preparing:
      ("Preparing Install", .accent, "arrow.down.circle.fill")
    case .downloading:
      ("Downloading", .accent, "arrow.down.circle.fill")
    case .verifying:
      ("Verifying", .accent, "checkmark.shield.fill")
    case .installing:
      if installState.helperStatus == .preparing {
        ("Preparing Helper", .accent, "gearshape.fill")
      } else {
        ("Installing", .accent, "arrow.down.circle.fill")
      }
    case .relaunching:
      ("Relaunching", .accent, "arrow.clockwise")
    case .completed:
      ("Updated", .positive, "checkmark.circle.fill")
    case .failed:
      ("Install Failed", .error, "xmark.circle.fill")
    case .idle:
      switch result.decision {
      case .upToDate:
        ("Up to Date", .positive, "checkmark.circle.fill")
      case .updateAvailable:
        ("Update Available", .attention, "arrow.up.circle.fill")
      case .unknown:
        ("Unknown", .neutral, "questionmark.circle")
      case .ambiguous:
        ("Needs Review", .attention, "scope")
      case .unsupported:
        ("Unsupported", .error, "xmark.circle.fill")
      case .ignored:
        ("Ignored", .neutral, "minus.circle")
      }
    }
  }

  private static func defaultSortRank(
    result: AppDecision,
    installState: InstallCoordinator.OperationState
  ) -> Int {
    switch installState.phase {
    case .preparing, .downloading, .verifying, .installing, .relaunching:
      return 0
    case .failed:
      return 1
    case .completed:
      return 2
    case .idle:
      switch result.decision {
      case .updateAvailable:
        return 3
      case .ambiguous, .unknown:
        return 4
      case .upToDate:
        return 5
      case .unsupported, .ignored:
        return 6
      }
    }
  }
}

nonisolated enum ResultsBrowserDateParser {
  static func date(from string: String?) -> Date? {
    guard let string else { return nil }
    let iso8601WithFractions = ISO8601DateFormatter()
    iso8601WithFractions.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = iso8601WithFractions.date(from: string) {
      return date
    }
    let iso8601 = ISO8601DateFormatter()
    iso8601.formatOptions = [.withInternetDateTime]
    return iso8601.date(from: string)
  }
}
