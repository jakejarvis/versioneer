import Foundation

/// A parsed version string that supports lexicographic comparison via a normalized representation.
/// Ported from `packages/core/src/versioning/parse.ts` to ensure parity with the backend.
nonisolated struct Version: Sendable, Comparable, Equatable {
  let raw: String
  let normalized: String
  let major: Int
  let minor: Int
  let patch: Int
  let extra: [Int]
  let preReleaseTag: String?
  let preReleaseNumber: Int?
  let buildMetadata: String?
  let valid: Bool

  var isPreRelease: Bool { preReleaseTag != nil }

  /// Returns true if this version is greater than or equal to `other`.
  func isAtLeast(_ other: Version) -> Bool {
    self >= other
  }

  // MARK: - Comparable

  static func < (lhs: Version, rhs: Version) -> Bool {
    if !lhs.valid && !rhs.valid { return false }
    if !lhs.valid { return true }
    if !rhs.valid { return false }
    return lhs.normalized < rhs.normalized
  }

  static func == (lhs: Version, rhs: Version) -> Bool {
    if !lhs.valid && !rhs.valid { return true }
    if !lhs.valid || !rhs.valid { return false }
    return lhs.normalized == rhs.normalized
  }

  // MARK: - Initializer

  init(_ raw: String) {
    self = Self.parse(raw)
  }

  // MARK: - Private

  private static let maxSegment = 9_999_999_999

  /// Pre-release tag ordering — must match packages/core/src/versioning/parse.ts exactly.
  private static let preReleaseTags: [String: Int] = [
    "alpha": 0, "a": 0,
    "beta": 1, "b": 1,
    "dev": -1, "nightly": -1,
    "rc": 2, "cr": 2,
    "preview": 1, "pre": 1,
  ]

  private static func parse(_ raw: String) -> Version {
    let trimmed = raw.trimmingCharacters(in: .whitespaces)

    guard !trimmed.isEmpty else {
      return invalid(raw)
    }

    var working = trimmed

    // Strip leading 'v' or 'V'
    if working.first == "v" || working.first == "V" {
      working = String(working.dropFirst())
    }

    // Strip leading name prefix (e.g. "release-3.5.7", "XQuartz-2.8.6_beta4").
    // Only strip when the prefix is NOT a known pre-release tag.
    if let match = working.range(
      of: #"^([a-zA-Z]+)[-_](?=\d)"#, options: .regularExpression)
    {
      let prefixEnd = working.index(before: match.upperBound)  // exclude the separator
      let prefix = String(working[match.lowerBound..<prefixEnd]).lowercased()
      if preReleaseTags[prefix] == nil {
        working = String(working[match.upperBound...])
      }
    }

    // Extract build metadata after '+'
    var buildMetadata: String?
    if let plusIndex = working.firstIndex(of: "+") {
      buildMetadata = String(working[working.index(after: plusIndex)...])
      working = String(working[..<plusIndex])
    }

    // Extract pre-release info
    var preReleaseTag: String?
    var preReleaseNumber: Int?

    // Pattern: version-beta.3, version-rc1, version_alpha
    if let dashMatch = working.wholeMatch(
      of: /^([\d.]+)[_-]([a-zA-Z]+)\.?(\d+)?$/)
    {
      working = String(dashMatch.1)
      preReleaseTag = String(dashMatch.2).lowercased()
      if let numStr = dashMatch.3 {
        preReleaseNumber = Int(numStr)
      }
    } else if let inlineMatch = working.wholeMatch(
      of: /^([\d.]+?)([a-zA-Z]+)(\d*)$/)
    {
      // Pattern: 5.0b3, 1.0alpha2
      working = String(inlineMatch.1)
      preReleaseTag = String(inlineMatch.2).lowercased()
      if !inlineMatch.3.isEmpty {
        preReleaseNumber = Int(inlineMatch.3)
      }
    }

    // Reject consecutive dots
    if working.contains("..") {
      return invalid(raw)
    }

    // Strip trailing dots
    while working.hasSuffix(".") {
      working = String(working.dropLast())
    }

    // Parse numeric segments
    let segments = working.split(separator: ".").map { segment -> Int in
      guard let n = Int(segment) else { return 0 }
      return min(max(n, 0), maxSegment)
    }

    if segments.isEmpty || (segments.count == 1 && segments[0] == 0 && working != "0") {
      return invalid(raw)
    }

    let major = segments.count > 0 ? segments[0] : 0
    let minor = segments.count > 1 ? segments[1] : 0
    let patch = segments.count > 2 ? segments[2] : 0
    let extra = segments.count > 3 ? Array(segments[3...]) : []

    return Version(
      raw: raw,
      normalized: buildNormalized(
        major: major, minor: minor, patch: patch, extra: extra,
        preReleaseTag: preReleaseTag, preReleaseNumber: preReleaseNumber
      ),
      major: major, minor: minor, patch: patch, extra: extra,
      preReleaseTag: preReleaseTag, preReleaseNumber: preReleaseNumber,
      buildMetadata: buildMetadata, valid: true
    )
  }

  private static func buildNormalized(
    major: Int, minor: Int, patch: Int, extra: [Int],
    preReleaseTag: String?, preReleaseNumber: Int?
  ) -> String {
    // Pad each segment to 10 digits for lexicographic comparison
    let allSegments = [major, minor, patch] + extra
    var norm = allSegments.map { String(format: "%010d", $0) }.joined(separator: ".")

    if let tag = preReleaseTag {
      let tagOrder = preReleaseTags[tag] ?? 1
      // Pre-release sorts before release: use -0 prefix (sorts before -1 used for releases)
      norm += "-0.\(String(format: "%03d", tagOrder))"
      norm += ".\(String(format: "%010d", preReleaseNumber ?? 0))"
    } else {
      // Release versions get -1 suffix so they sort after pre-releases
      norm += "-1"
    }

    return norm
  }

  private static func invalid(_ raw: String) -> Version {
    Version(
      raw: raw, normalized: "", major: 0, minor: 0, patch: 0,
      extra: [], preReleaseTag: nil, preReleaseNumber: nil,
      buildMetadata: nil, valid: false
    )
  }

  /// Memberwise init for internal use only.
  private init(
    raw: String, normalized: String,
    major: Int, minor: Int, patch: Int, extra: [Int],
    preReleaseTag: String?, preReleaseNumber: Int?,
    buildMetadata: String?, valid: Bool
  ) {
    self.raw = raw
    self.normalized = normalized
    self.major = major
    self.minor = minor
    self.patch = patch
    self.extra = extra
    self.preReleaseTag = preReleaseTag
    self.preReleaseNumber = preReleaseNumber
    self.buildMetadata = buildMetadata
    self.valid = valid
  }
}
