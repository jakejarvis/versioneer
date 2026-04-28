import Foundation

nonisolated struct InstallVerificationSummary: Codable, Sendable {
  let strategy: String
  var executionRoute: String? = nil
  var hashVerified: Bool? = nil
  var signatureVerified: Bool? = nil
  var notarizationVerified: Bool? = nil
  var bundleIdMatch: Bool? = nil
  var teamIdMatch: Bool? = nil
  var versionMatch: Bool? = nil
  var observedBundleId: String? = nil
  var observedTeamId: String? = nil
  var observedVersion: String? = nil
}

nonisolated struct InstallExecutionCreateRequest: Codable, Sendable {
  let client: InventoryCheckRequest.ClientInfo
  let target: Target
  let install: Install
  let expected: Expected

  struct Target: Codable, Sendable {
    let appId: String
    let releaseId: String
    let artifactId: String?
    let targetArchitecture: String?
    let channel: String?
  }

  struct Install: Codable, Sendable {
    let strategy: String
    let executionRoute: String
  }

  struct Expected: Codable, Sendable {
    let previousVersion: String?
    let bundleId: String?
    let teamId: String?
  }
}

nonisolated struct InstallExecutionCreateResponse: Codable, Sendable {
  let execution: Execution

  struct Execution: Codable, Sendable {
    let id: String
    let status: String
  }
}

nonisolated struct InstallExecutionEventRequest: Codable, Sendable {
  let event: Event
  let verification: InstallVerificationSummary?

  static func sanitizedErrorMessage(_ message: String?) -> String? {
    guard
      var sanitized = message?.trimmingCharacters(in: .whitespacesAndNewlines),
      !sanitized.isEmpty
    else {
      return nil
    }

    for pattern in sensitiveTextPatterns {
      sanitized = replacingMatches(
        in: sanitized,
        pattern: pattern.regex,
        with: pattern.replacement
      )
    }

    let maxLength = 1000
    if sanitized.count > maxLength {
      sanitized = String(sanitized.prefix(maxLength)) + "..."
    }
    return sanitized
  }

  struct Event: Codable, Sendable {
    let status: String
    let installedVersion: String?
    let errorMessage: String?
  }

  private static let sensitiveTextPatterns: [(regex: String, replacement: String)] = [
    (
      #"\b(authorization|cookie|password|secret|token|api[_-]?key)=(?:Bearer\s+)?([^&\s]+)"#,
      "$1=[redacted]"
    ),
    (#"\bBearer\s+[A-Za-z0-9._~+/=-]+"#, "Bearer [redacted]"),
    (#"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b"#, "[redacted-jwt]"),
    (#"\b(?:phc|ghp|github_pat|sk)-[A-Za-z0-9_=-]{8,}\b"#, "[redacted-token]"),
    (#"https?://[^\s"']+"#, "[url]"),
    (#"file://[^\s"']+"#, "[path]"),
    (#"/Users/[^\s"']+"#, "[path]"),
    (#"/private/var/folders/[^\s"']+"#, "[path]"),
    (#"/var/folders/[^\s"']+"#, "[path]"),
    (#"/tmp/[^\s"']+"#, "[path]"),
  ]

  private static func replacingMatches(
    in value: String,
    pattern: String,
    with replacement: String
  ) -> String {
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) else {
      return value
    }
    let range = NSRange(value.startIndex..., in: value)
    return regex.stringByReplacingMatches(
      in: value,
      options: [],
      range: range,
      withTemplate: replacement
    )
  }
}

nonisolated struct InstallExecutionEventResponse: Codable, Sendable {
  let execution: InstallExecutionCreateResponse.Execution
}
