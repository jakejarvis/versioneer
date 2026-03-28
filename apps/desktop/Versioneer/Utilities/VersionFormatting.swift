import Foundation

/// Helpers for presenting version strings and decision statuses.
nonisolated enum VersionFormatting {
  /// Returns a human-readable label for a decision status.
  static func statusLabel(for decision: AppDecision.Decision) -> String {
    switch decision {
    case .upToDate: "Up to Date"
    case .updateAvailable: "Update Available"
    case .ambiguous: "Ambiguous"
    case .notTracked: "Not Tracked"
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

  /// Formats a date string (ISO-8601 or RFC 2822) into a relative or short date.
  static func relativeDate(from dateString: String?) -> String {
    guard let dateString else { return "—" }
    guard let date = parseDate(dateString) else { return dateString }
    let relative = RelativeDateTimeFormatter()
    relative.unitsStyle = .abbreviated
    return relative.localizedString(for: date, relativeTo: .now)
  }

  /// Attempts to parse a date string in ISO-8601 or RFC 2822 format.
  private static func parseDate(_ string: String) -> Date? {
    let iso8601Fractional = ISO8601DateFormatter()
    iso8601Fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let date = iso8601Fractional.date(from: string) { return date }

    let iso8601 = ISO8601DateFormatter()
    if let date = iso8601.date(from: string) { return date }

    let rfc2822 = DateFormatter()
    rfc2822.locale = Locale(identifier: "en_US_POSIX")
    rfc2822.dateFormat = "EEE, dd MMM yyyy HH:mm:ss Z"
    if let date = rfc2822.date(from: string) { return date }

    // Fallback with flexible parsing
    rfc2822.dateFormat = "EEE, d MMM yyyy HH:mm:ss Z"
    return rfc2822.date(from: string)
  }
}
