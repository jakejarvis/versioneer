import Foundation

/// Response from `GET /v1/client/preflight`.
nonisolated struct PreflightResponse: Codable, Sendable {
  let dismissedBundleIds: [String]
}
