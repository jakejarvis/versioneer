import Foundation

/// Extracts metadata from an app bundle on disk.
enum BundleMetadataReader {
    /// Reads an `InstalledApp` from a `.app` bundle URL.
    /// Returns `nil` if the bundle cannot be loaded or has no usable name.
    nonisolated static func readApp(at url: URL) -> InstalledApp? {
        guard let bundle = Bundle(url: url) else { return nil }
        let info = bundle.infoDictionary ?? [:]

        let name = (info["CFBundleDisplayName"] as? String)
            ?? (info["CFBundleName"] as? String)
            ?? url.deletingPathExtension().lastPathComponent

        let bundleId = info["CFBundleIdentifier"] as? String
        let version = info["CFBundleShortVersionString"] as? String
        let buildNumber = info["CFBundleVersion"] as? String
        let teamId = readTeamId(from: bundle)

        let sparkleInfo = readSparkleInfo(from: bundle, info: info, bundleId: bundleId)

        return InstalledApp(
            name: name,
            bundleId: bundleId,
            version: version,
            buildNumber: buildNumber,
            teamId: teamId,
            path: url.path,
            architecture: nil,
            sparkleFeedUrl: sparkleInfo.feedUrl,
            sparklePublicKey: sparkleInfo.publicKey,
            hasSparkle: sparkleInfo.hasSparkle
        )
    }

    // MARK: - Sparkle metadata

    private struct SparkleInfo {
        let feedUrl: String?
        let publicKey: String?
        let hasSparkle: Bool
    }

    nonisolated private static func readSparkleInfo(
        from bundle: Bundle,
        info: [String: Any],
        bundleId: String?
    ) -> SparkleInfo {
        let feedUrl = readSparkleFeedUrl(from: info, bundle: bundle, bundleId: bundleId)
        let publicKey = info["SUPublicEDKey"] as? String
        let hasSparkle = feedUrl != nil || publicKey != nil || sparkleFrameworkExists(in: bundle)

        return SparkleInfo(feedUrl: feedUrl, publicKey: publicKey, hasSparkle: hasSparkle)
    }

    /// Reads the Sparkle feed URL from Info.plist, stripping stray quotes.
    /// Falls back to a DevMate-convention URL when DevMateKit is present.
    nonisolated private static func readSparkleFeedUrl(
        from info: [String: Any],
        bundle: Bundle,
        bundleId: String?
    ) -> String? {
        if let raw = info["SUFeedURL"] as? String {
            // Strip surrounding single/double quotes that some developers leave in
            let trimmed = raw.trimmingCharacters(in: .whitespaces)
            let unquoted = trimmed
                .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            if !unquoted.isEmpty {
                return unquoted
            }
        }

        // DevMate fallback: apps using DevMateKit have feeds at a predictable URL
        if let bundleId, devMateFrameworkExists(in: bundle) {
            return "https://updates.devmate.com/\(bundleId).xml"
        }

        return nil
    }

    /// Checks whether `Sparkle.framework` exists inside the app bundle's Frameworks directory.
    nonisolated private static func sparkleFrameworkExists(in bundle: Bundle) -> Bool {
        let frameworksUrl = bundle.bundleURL
            .appendingPathComponent("Contents/Frameworks/Sparkle.framework")
        return FileManager.default.fileExists(atPath: frameworksUrl.path)
    }

    /// Checks whether `DevMateKit.framework` exists inside the app bundle's Frameworks directory.
    nonisolated private static func devMateFrameworkExists(in bundle: Bundle) -> Bool {
        let frameworksDir = bundle.bundleURL
            .appendingPathComponent("Contents/Frameworks")
        guard let contents = try? FileManager.default.contentsOfDirectory(atPath: frameworksDir.path) else {
            return false
        }
        return contents.contains { $0.contains("DevMateKit") }
    }

    // MARK: - Team ID

    nonisolated private static func readTeamId(from bundle: Bundle) -> String? {
        // Team ID is embedded in the code signature; reading it requires
        // Security framework calls that are non-trivial under sandbox.
        // For v1, we leave this nil and revisit when needed.
        nil
    }
}
