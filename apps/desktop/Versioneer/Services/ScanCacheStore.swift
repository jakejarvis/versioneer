import Foundation
import Logging

/// Persists the most recent scan results to disk for instant display on launch.
nonisolated struct ScanCacheStore: Sendable {

  /// The data that gets serialized to/from the cache file.
  struct CachedScanData: Codable, Sendable {
    let installedApps: [InstalledApp]
    let inventoryResults: [AppDecision]
    let snapshotId: String?
  }

  private static let fileName = "ScanCache.json"

  /// Returns the cache file URL inside Application Support.
  /// Creates the parent directory if it does not exist.
  private static var fileURL: URL? {
    guard
      let appSupport = FileManager.default.urls(
        for: .applicationSupportDirectory,
        in: .userDomainMask
      ).first
    else { return nil }

    let bundleId = Bundle.main.bundleIdentifier ?? "com.jakejarvis.versioneer"
    let directory = appSupport.appendingPathComponent(bundleId)

    try? FileManager.default.createDirectory(
      at: directory,
      withIntermediateDirectories: true
    )

    return directory.appendingPathComponent(fileName)
  }

  /// Saves scan data to disk. Failures are logged but never thrown.
  func save(_ data: CachedScanData) {
    guard let url = Self.fileURL else {
      Logger.cache.warning("Could not determine cache file URL")
      return
    }

    do {
      let jsonData = try JSONEncoder().encode(data)
      try jsonData.write(to: url, options: .atomic)
      Logger.cache.info("Saved cache: \(data.inventoryResults.count) results")
    } catch {
      Logger.cache.error("Failed to save cache: \(error.localizedDescription)")
    }
  }

  /// Loads cached scan data from disk. Returns nil if no cache exists or decoding fails.
  func load() -> CachedScanData? {
    guard let url = Self.fileURL else { return nil }

    do {
      let data = try Data(contentsOf: url)
      let cached = try JSONDecoder().decode(CachedScanData.self, from: data)
      Logger.cache.info("Loaded cache: \(cached.inventoryResults.count) results")
      return cached
    } catch {
      Logger.cache.debug("No usable cache: \(error.localizedDescription)")
      return nil
    }
  }
}
