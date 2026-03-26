import Foundation

/// Helpers for presenting version strings and decision statuses.
nonisolated enum VersionFormatting {
    /// Returns a human-readable label for a decision status.
    static func statusLabel(for decision: AppDecision.Decision) -> String {
        switch decision {
        case .unknown: "Unknown"
        case .upToDate: "Up to Date"
        case .updateAvailable: "Update Available"
        case .ambiguous: "Ambiguous"
        case .unsupported: "Unsupported"
        case .ignored: "Ignored"
        }
    }

    /// Returns a compact version display, e.g. "1.2.3" or "—" if nil.
    static func displayVersion(_ version: String?) -> String {
        version ?? "—"
    }

    /// Formats a confidence percentage, e.g. "87%".
    static func confidenceLabel(_ confidence: Double?) -> String {
        guard let confidence else { return "—" }
        return "\(Int(confidence))%"
    }

    /// Formats an ISO-8601 date string into a relative or short date.
    static func relativeDate(from isoString: String?) -> String {
        guard let isoString else { return "—" }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let date = formatter.date(from: isoString) ?? ISO8601DateFormatter().date(from: isoString) else {
            return isoString
        }
        let relative = RelativeDateTimeFormatter()
        relative.unitsStyle = .abbreviated
        return relative.localizedString(for: date, relativeTo: .now)
    }
}
