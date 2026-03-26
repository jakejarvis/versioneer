import Foundation

/// A single backend decision about an installed app.
nonisolated struct AppDecision: Identifiable, Codable, Hashable, Sendable {
    var id: String { appName + (bundleId ?? "") }

    let appName: String
    let bundleId: String?
    let installedVersion: String?
    let matchedAppId: String?
    let matchedAppName: String?
    let matchConfidence: Double?
    let decision: Decision
    let latestVersion: String?
    let latestVersionRaw: String?
    let releasedAt: String?

    enum Decision: String, Codable, Sendable, CaseIterable {
        case unknown
        case upToDate = "up_to_date"
        case updateAvailable = "update_available"
        case ambiguous
        case unsupported
        case ignored
    }

    /// Returns a copy with only the decision field changed.
    func replacing(decision newDecision: Decision) -> AppDecision {
        AppDecision(
            appName: appName,
            bundleId: bundleId,
            installedVersion: installedVersion,
            matchedAppId: matchedAppId,
            matchedAppName: matchedAppName,
            matchConfidence: matchConfidence,
            decision: newDecision,
            latestVersion: latestVersion,
            latestVersionRaw: latestVersionRaw,
            releasedAt: releasedAt
        )
    }
}
