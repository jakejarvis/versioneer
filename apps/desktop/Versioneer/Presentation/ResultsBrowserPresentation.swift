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

nonisolated struct ResultsBrowserRowPresentation: Identifiable, Equatable, Sendable {
  enum Tone: String, Equatable, Sendable {
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
  let hasUpdateAction: Bool
  let versionDiffText: String?
  let defaultSortRank: Int
  let latestVersionSortKey: String
  let releasedAtSortDate: Date?

  static func make(
    result: AppDecision,
    installState: InstallCoordinator.OperationState,
    hasUpdateAction: Bool
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
      canInstall: result.canInstall && installState.phase == .idle,
      hasUpdateAction: hasUpdateAction,
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
      return ("Preparing Install", .accent, "arrow.down.circle.fill")
    case .downloading:
      return ("Downloading", .accent, "arrow.down.circle.fill")
    case .verifying:
      return ("Verifying", .accent, "checkmark.shield.fill")
    case .installing:
      if installState.helperStatus == .preparing {
        return ("Preparing Helper", .accent, "gearshape.fill")
      } else {
        return ("Installing", .accent, "arrow.down.circle.fill")
      }
    case .relaunching:
      return ("Relaunching", .accent, "arrow.clockwise")
    case .completed:
      return ("Updated", .positive, "checkmark.circle.fill")
    case .failed:
      return ("Install Failed", .error, "xmark.circle.fill")
    case .idle:
      if result.isLocalOnly {
        switch result.decision {
        case .updateAvailable:
          return ("Local Update Available", .attention, "arrow.up.circle")
        case .ambiguous:
          return ("Needs Review", .attention, "scope")
        case .upToDate, .localOnly:
          return ("Local Only", .neutral, "desktopcomputer")
        }
      }
      switch result.decision {
      case .upToDate:
        return ("Up to Date", .positive, "checkmark.circle.fill")
      case .updateAvailable:
        return ("Update Available", .accent, "arrow.up.circle.fill")
      case .ambiguous:
        return ("Needs Review", .attention, "scope")
      case .localOnly:
        return ("Local Only", .neutral, "desktopcomputer")
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
        return result.isLocalOnly ? 4 : 3
      case .ambiguous:
        return 5
      case .upToDate:
        return 6
      case .localOnly:
        return 7
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
