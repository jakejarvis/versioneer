import Foundation

/// Extracts metadata from an app bundle on disk.
enum BundleMetadataReader {
    /// Reads an `InstalledApp` from a `.app` bundle URL.
    /// Returns `nil` if the bundle cannot be loaded or has no usable name.
    static func readApp(at url: URL) -> InstalledApp? {
        guard let bundle = Bundle(url: url) else { return nil }
        let info = bundle.infoDictionary ?? [:]

        let name = (info["CFBundleDisplayName"] as? String)
            ?? (info["CFBundleName"] as? String)
            ?? url.deletingPathExtension().lastPathComponent

        let bundleId = info["CFBundleIdentifier"] as? String
        let version = info["CFBundleShortVersionString"] as? String
        let buildNumber = info["CFBundleVersion"] as? String
        let teamId = readTeamId(from: bundle)

        return InstalledApp(
            name: name,
            bundleId: bundleId,
            version: version,
            buildNumber: buildNumber,
            teamId: teamId,
            path: url.path,
            architecture: nil
        )
    }

    private static func readTeamId(from bundle: Bundle) -> String? {
        // Team ID is embedded in the code signature; reading it requires
        // Security framework calls that are non-trivial under sandbox.
        // For v1, we leave this nil and revisit when needed.
        nil
    }
}
