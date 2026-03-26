import Foundation

/// Represents a locally discovered app bundle on disk.
nonisolated struct InstalledApp: Identifiable, Codable, Sendable {
    var id: String { bundleId ?? path }

    let name: String
    let bundleId: String?
    let version: String?
    let buildNumber: String?
    let teamId: String?
    let path: String
    let architecture: String?

    // Sparkle update metadata
    let sparkleFeedUrl: String?
    let sparklePublicKey: String?
    let hasSparkle: Bool

    init(
        name: String,
        bundleId: String?,
        version: String?,
        buildNumber: String?,
        teamId: String?,
        path: String,
        architecture: String?,
        sparkleFeedUrl: String? = nil,
        sparklePublicKey: String? = nil,
        hasSparkle: Bool = false
    ) {
        self.name = name
        self.bundleId = bundleId
        self.version = version
        self.buildNumber = buildNumber
        self.teamId = teamId
        self.path = path
        self.architecture = architecture
        self.sparkleFeedUrl = sparkleFeedUrl
        self.sparklePublicKey = sparklePublicKey
        self.hasSparkle = hasSparkle
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        name = try container.decode(String.self, forKey: .name)
        bundleId = try container.decodeIfPresent(String.self, forKey: .bundleId)
        version = try container.decodeIfPresent(String.self, forKey: .version)
        buildNumber = try container.decodeIfPresent(String.self, forKey: .buildNumber)
        teamId = try container.decodeIfPresent(String.self, forKey: .teamId)
        path = try container.decode(String.self, forKey: .path)
        architecture = try container.decodeIfPresent(String.self, forKey: .architecture)
        sparkleFeedUrl = try container.decodeIfPresent(String.self, forKey: .sparkleFeedUrl)
        sparklePublicKey = try container.decodeIfPresent(String.self, forKey: .sparklePublicKey)
        hasSparkle = try container.decodeIfPresent(Bool.self, forKey: .hasSparkle) ?? false
    }
}
