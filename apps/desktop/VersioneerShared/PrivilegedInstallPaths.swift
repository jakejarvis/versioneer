import Foundation

nonisolated enum PrivilegedInstallPaths {
    static func stagingRoot(in homeDirectory: URL) -> URL {
        homeDirectory
            .appendingPathComponent("Library", isDirectory: true)
            .appendingPathComponent("Application Support", isDirectory: true)
            .appendingPathComponent("Versioneer", isDirectory: true)
            .appendingPathComponent("InstallStaging", isDirectory: true)
    }

    static func stagingDirectory(executionId: String, in homeDirectory: URL) -> URL {
        stagingRoot(in: homeDirectory).appendingPathComponent(executionId, isDirectory: true)
    }
}
