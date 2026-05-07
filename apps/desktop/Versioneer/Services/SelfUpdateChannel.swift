import Foundation

enum SelfUpdateChannel: String, CaseIterable, Codable, Identifiable, Sendable {
  case stable
  case nightly

  static let bundleInfoKey = "VersioneerReleaseTrack"

  var id: String { rawValue }

  var title: String {
    switch self {
    case .stable:
      "Stable"
    case .nightly:
      "Nightly"
    }
  }

  var statusDescription: String {
    switch self {
    case .stable:
      "Versioneer checks the default release feed only."
    case .nightly:
      "Versioneer checks the default release feed and nightly builds."
    }
  }

  var feedScopeDescription: String {
    switch self {
    case .stable:
      "stable releases only"
    case .nightly:
      "stable releases and nightly builds"
    }
  }

  var allowedSparkleChannels: Set<String> {
    switch self {
    case .stable:
      []
    case .nightly:
      ["nightly"]
    }
  }

  static func fromBundleValue(_ value: String?) -> Self? {
    guard let concrete = concreteValue(value) else { return nil }
    return Self(rawValue: concrete.lowercased())
  }

  private static func concreteValue(_ value: String?) -> String? {
    guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines),
      !trimmed.isEmpty,
      !trimmed.contains("$(")
    else {
      return nil
    }

    return trimmed
  }
}
