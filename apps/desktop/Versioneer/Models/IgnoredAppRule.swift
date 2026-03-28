import Foundation

/// A user-managed rule for hiding an installed app from normal result sections.
nonisolated struct IgnoredAppRule: Codable, Hashable, Identifiable, Sendable {
  enum MatchType: String, Codable, CaseIterable, Sendable {
    case bundleId = "bundle_id"
    case path

    var title: String {
      switch self {
      case .bundleId: "Bundle ID"
      case .path: "Path"
      }
    }
  }

  let displayName: String
  let matchType: MatchType
  let matchValue: String

  var id: String { "\(matchType.rawValue):\(matchValue)" }

  var detailText: String {
    "\(matchType.title): \(matchValue)"
  }

  static func make(displayName: String, matchType: MatchType, rawValue: String) -> IgnoredAppRule? {
    guard let normalized = normalize(rawValue, for: matchType) else { return nil }

    let trimmedDisplayName = displayName.trimmingCharacters(in: .whitespacesAndNewlines)
    let resolvedDisplayName =
      if trimmedDisplayName.isEmpty {
        switch matchType {
        case .bundleId:
          normalized
        case .path:
          URL(fileURLWithPath: normalized).deletingPathExtension().lastPathComponent
        }
      } else {
        trimmedDisplayName
      }

    return IgnoredAppRule(
      displayName: resolvedDisplayName,
      matchType: matchType,
      matchValue: normalized
    )
  }

  static func make(from app: InstalledApp) -> IgnoredAppRule {
    if let bundleId = app.bundleId,
      let rule = make(displayName: app.name, matchType: .bundleId, rawValue: bundleId)
    {
      return rule
    }

    guard let rule = make(displayName: app.name, matchType: .path, rawValue: app.path) else {
      preconditionFailure("Installed apps always provide a non-empty path")
    }
    return rule
  }

  func matches(_ app: InstalledApp) -> Bool {
    switch matchType {
    case .bundleId:
      guard let bundleId = app.bundleId else { return false }
      return Self.normalize(bundleId, for: .bundleId) == matchValue
    case .path:
      return Self.normalize(app.path, for: .path) == matchValue
    }
  }

  static func inferredMatchType(for input: String) -> MatchType {
    let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.hasPrefix("/") || trimmed.hasPrefix("~") ? .path : .bundleId
  }

  private static func normalize(_ rawValue: String, for matchType: MatchType) -> String? {
    let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty else { return nil }

    switch matchType {
    case .bundleId:
      return trimmed.lowercased()
    case .path:
      let expanded = NSString(string: trimmed).expandingTildeInPath
      let standardized = URL(fileURLWithPath: expanded).standardizedFileURL.path
      return standardized.isEmpty ? nil : standardized
    }
  }
}
