import Foundation
import Logging

/// Scans macOS app directories recursively for installed `.app` bundles.
actor AppScanner {
  private static let prefetchKeys: [URLResourceKey] = [
    .isDirectoryKey,
    .isPackageKey,
  ]

  /// Recursively scans the given root directories for `.app` bundles.
  /// Deduplicates by resolved real path so overlapping roots and symlinks
  /// do not double-count.
  func scan(roots: [URL]) async -> [InstalledApp] {
    Logger.appScanner.info("Starting app scan across \(roots.count) root(s)")
    let startTime = CFAbsoluteTimeGetCurrent()

    let fileManager = FileManager.default
    var seenPaths = Set<String>()
    var results: [InstalledApp] = []

    for root in roots {
      guard fileManager.fileExists(atPath: root.path) else {
        Logger.appScanner.debug("Skipping non-existent directory: \(root.path)")
        continue
      }

      guard
        let enumerator = fileManager.enumerator(
          at: root,
          includingPropertiesForKeys: Self.prefetchKeys,
          options: [.skipsHiddenFiles, .skipsPackageDescendants],
          errorHandler: { url, error in
            Logger.appScanner.debug(
              "Enumerator error at \(url.path): \(error.localizedDescription)")
            return true
          }
        )
      else {
        Logger.appScanner.error("Could not create enumerator for \(root.path)")
        continue
      }

      while let obj = enumerator.nextObject() {
        guard let item = obj as? URL else { continue }
        guard item.pathExtension == "app" else { continue }

        // Resolve symlinks and deduplicate
        let resolved = item.resolvingSymlinksInPath().path
        guard seenPaths.insert(resolved).inserted else { continue }

        if let app = BundleMetadataReader.readApp(at: item) {
          guard !GloballyIgnoredApps.shouldIgnore(bundleId: app.bundleId) else { continue }
          results.append(app)
        } else {
          Logger.appScanner.debug("Could not read bundle: \(item.lastPathComponent)")
        }
      }
    }

    let elapsed = CFAbsoluteTimeGetCurrent() - startTime
    Logger.appScanner.info(
      "Scan complete: found \(results.count) apps in \(String(format: "%.2f", elapsed))s")
    return results.sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
  }
}
