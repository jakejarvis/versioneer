import Foundation
import Logging

/// Scans standard macOS app directories for installed `.app` bundles.
actor AppScanner {
  private static let scanDirectories: [URL] = {
    var dirs: [URL] = []
    dirs.append(URL(fileURLWithPath: "/Applications"))
    if let home = FileManager.default.homeDirectoryForCurrentUser as URL? {
      dirs.append(home.appendingPathComponent("Applications"))
    }
    return dirs
  }()

  /// Scans `/Applications` and `~/Applications` for `.app` bundles.
  func scan() async -> [InstalledApp] {
    Logger.appScanner.info("Starting app scan")
    let startTime = CFAbsoluteTimeGetCurrent()

    var results: [InstalledApp] = []
    let fileManager = FileManager.default

    for directory in Self.scanDirectories {
      guard fileManager.fileExists(atPath: directory.path) else {
        Logger.appScanner.debug("Skipping non-existent directory: \(directory.path)")
        continue
      }

      do {
        let contents = try fileManager.contentsOfDirectory(
          at: directory,
          includingPropertiesForKeys: [.isDirectoryKey],
          options: [.skipsHiddenFiles]
        )

        for item in contents where item.pathExtension == "app" {
          if let app = BundleMetadataReader.readApp(at: item) {
            results.append(app)
          } else {
            Logger.appScanner.debug("Could not read bundle: \(item.lastPathComponent)")
          }
        }
      } catch {
        Logger.appScanner.error(
          "Failed to scan directory \(directory.path): \(error.localizedDescription)")
      }
    }

    let elapsed = CFAbsoluteTimeGetCurrent() - startTime
    Logger.appScanner.info(
      "Scan complete: found \(results.count) apps in \(String(format: "%.2f", elapsed))s")
    return results.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
  }
}
