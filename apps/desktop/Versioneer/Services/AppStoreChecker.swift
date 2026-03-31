import Foundation
import Logging

/// Checks for available Mac App Store updates using the iTunes Search API.
/// Replaces the previous mas-cli-based approach with direct API calls and
/// Spotlight-sourced Adam IDs for reliable app identification.
actor AppStoreChecker {
  struct AppStoreResult: Sendable {
    /// Confirmed App Store Adam ID (from Spotlight or API lookup).
    let masAppId: String
    /// The latest available version, or nil if the lookup succeeded but had no version.
    let latestVersion: String?
    /// Release notes text from the App Store listing.
    let releaseNotes: String?
    /// ISO-8601 release date string.
    let releaseDate: String?
  }

  private let session: URLSession

  init() {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 30
    self.session = URLSession(configuration: config)
  }

  /// Checks all MAS-installed apps for available updates via the iTunes Search API.
  /// Returns a dictionary keyed by `InstalledApp.id`.
  func checkAll(apps: [InstalledApp]) async -> [String: AppStoreResult] {
    let masApps = apps.filter(\.isMasApp)
    guard !masApps.isEmpty else { return [:] }

    Logger.mas.info("Checking \(masApps.count) App Store apps via iTunes API")

    return await withTaskGroup(of: (String, AppStoreResult?).self) { group in
      for app in masApps {
        group.addTask {
          let result = await self.check(app: app)
          return (app.id, result)
        }
      }

      var results: [String: AppStoreResult] = [:]
      for await (appId, result) in group {
        if let result { results[appId] = result }
      }

      Logger.mas.info("App Store checks complete: \(results.count)/\(masApps.count) succeeded")
      return results
    }
  }

  // MARK: - Single-app lookup

  private func check(app: InstalledApp) async -> AppStoreResult? {
    let userStorefront = userStorefront()

    // Strategy 1: Direct Adam ID lookup (fastest, most reliable)
    if let adamID = app.masAppId {
      if let result = await lookupByAdamID(adamID, storefront: userStorefront) {
        return result
      }
      if userStorefront != "us" {
        if let result = await lookupByAdamID(adamID, storefront: "us") {
          return result
        }
      }
    }

    // Strategy 2: Bundle ID lookup (when Spotlight didn't provide an Adam ID)
    // Try desktopSoftware first (more accurate for native Mac apps), then fall back
    // to macSoftware (broader — includes Catalyst and iOS-wrapped apps, but may
    // return iPad metadata for some apps).
    if let bundleId = app.bundleId {
      for entity in ["desktopSoftware", "macSoftware"] {
        if let result = await lookupByBundleID(bundleId, entity: entity, storefront: userStorefront)
        {
          return result
        }
        if userStorefront != "us" {
          if let result = await lookupByBundleID(bundleId, entity: entity, storefront: "us") {
            return result
          }
        }
      }
    }

    return nil
  }

  // MARK: - iTunes API

  private func lookupByAdamID(
    _ adamID: String, storefront: String?
  ) async -> AppStoreResult? {
    var urlString = "https://itunes.apple.com/lookup?id=\(adamID)"
    if let storefront { urlString += "&country=\(storefront)" }
    return await performLookup(urlString: urlString)
  }

  private func lookupByBundleID(
    _ bundleId: String, entity: String, storefront: String?
  ) async -> AppStoreResult? {
    guard let encoded = bundleId.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed)
    else { return nil }
    var urlString = "https://itunes.apple.com/lookup?bundleId=\(encoded)&entity=\(entity)"
    if let storefront { urlString += "&country=\(storefront)" }
    return await performLookup(urlString: urlString)
  }

  nonisolated func performLookup(urlString: String) async -> AppStoreResult? {
    guard let url = URL(string: urlString) else { return nil }

    do {
      let (data, response) = try await session.data(for: URLRequest(url: url))

      guard let httpResponse = response as? HTTPURLResponse,
        httpResponse.statusCode == 200
      else { return nil }

      return parseResponse(data)
    } catch {
      Logger.mas.debug("iTunes lookup failed for \(urlString): \(error.localizedDescription)")
      return nil
    }
  }

  // MARK: - Response parsing

  nonisolated func parseResponse(_ data: Data) -> AppStoreResult? {
    guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let resultCount = json["resultCount"] as? Int,
      resultCount > 0,
      let results = json["results"] as? [[String: Any]],
      let first = results.first
    else { return nil }

    let trackId = first["trackId"] as? Int
    guard let trackId else { return nil }

    return AppStoreResult(
      masAppId: String(trackId),
      latestVersion: first["version"] as? String,
      releaseNotes: first["releaseNotes"] as? String,
      releaseDate: first["currentVersionReleaseDate"] as? String
    )
  }

  // MARK: - Helpers

  private nonisolated func userStorefront() -> String? {
    Locale.current.region?.identifier.lowercased()
  }
}
