import Foundation

/// User-reported issue about match or version correctness.
enum FeedbackRequest: Sendable {
    case wrongMatch(WrongMatch)
    case wrongVersion(WrongVersion)
    case missingApp(MissingApp)

    struct WrongMatch: Codable, Sendable {
        let appName: String
        let bundleId: String?
        let matchedAppId: String
        let comment: String?
    }

    struct WrongVersion: Codable, Sendable {
        let appName: String
        let bundleId: String?
        let matchedAppId: String
        let reportedLatestVersion: String?
        let comment: String?
    }

    struct MissingApp: Codable, Sendable {
        let appName: String
        let bundleId: String?
        let homepageUrl: String?
        let comment: String?
    }
}
