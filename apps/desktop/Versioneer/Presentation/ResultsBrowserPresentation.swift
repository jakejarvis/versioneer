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
        case secondary
        case warning
        case negative
    }

    let id: String
    let appName: String
    let secondaryText: String?
    let statusText: String
    let statusTone: Tone
    let installedVersionText: String
    let latestVersionText: String
    let releasedDateText: String
    let defaultSortRank: Int
    let latestVersionSortKey: String
    let releasedAtSortDate: Date?

    static func make(
        result: AppDecision,
        installState: InstallCoordinator.OperationState
    ) -> ResultsBrowserRowPresentation {
        let status = statusPresentation(result: result, installState: installState)
        return ResultsBrowserRowPresentation(
            id: result.id,
            appName: result.matchedAppName ?? result.appName,
            secondaryText: result.bundleId ?? result.appName,
            statusText: status.text,
            statusTone: status.tone,
            installedVersionText: VersionFormatting.displayVersion(result.installedVersion),
            latestVersionText: VersionFormatting.displayVersion(result.latestVersion),
            releasedDateText: VersionFormatting.relativeDate(from: result.releasedAt),
            defaultSortRank: defaultSortRank(result: result, installState: installState),
            latestVersionSortKey: result.latestVersionRaw ?? result.latestVersion ?? "",
            releasedAtSortDate: ResultsBrowserDateParser.date(from: result.releasedAt)
        )
    }

    private static func statusPresentation(
        result: AppDecision,
        installState: InstallCoordinator.OperationState
    ) -> (text: String, tone: Tone) {
        switch installState.phase {
        case .preparing:
            ("Preparing Install", .accent)
        case .downloading:
            ("Downloading", .accent)
        case .verifying:
            ("Verifying", .accent)
        case .installing:
            if installState.helperStatus == .preparing {
                ("Preparing Helper", .accent)
            } else {
                ("Installing", .accent)
            }
        case .relaunching:
            ("Relaunching", .accent)
        case .completed:
            ("Installed", .positive)
        case .failed:
            ("Install Failed", .negative)
        case .idle:
            switch result.decision {
            case .upToDate:
                ("Up to Date", .positive)
            case .updateAvailable:
                ("Update Available", .warning)
            case .unknown:
                ("Unknown", .secondary)
            case .ambiguous:
                ("Needs Review", .warning)
            case .unsupported:
                ("Unsupported", .negative)
            case .ignored:
                ("Ignored", .secondary)
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
