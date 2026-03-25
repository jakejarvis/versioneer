import Foundation

/// Represents a locally discovered app bundle on disk.
struct InstalledApp: Identifiable, Codable, Sendable {
    var id: String { bundleId ?? path }

    let name: String
    let bundleId: String?
    let version: String?
    let buildNumber: String?
    let teamId: String?
    let path: String
    let architecture: String?
}
