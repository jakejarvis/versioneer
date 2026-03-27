import Foundation
import Logging

/// Fetches update information for Electron apps by querying GitHub releases or generic update servers.
actor ElectronChecker {

  /// The result of checking a single Electron app's update feed.
  struct ElectronResult: Sendable {
    let latestVersion: String?
    let downloadUrl: String?
    let publishedAt: String?
  }

  private let session: URLSession

  init() {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 30
    self.session = URLSession(configuration: config)
  }

  /// Checks all Electron apps with update URLs concurrently.
  func checkAll(apps: [InstalledApp]) async -> [String: ElectronResult] {
    let electronApps = apps.filter { $0.electronUpdateUrl != nil }
    guard !electronApps.isEmpty else { return [:] }

    Logger.electron.info("Checking \(electronApps.count) Electron update feeds locally")

    return await withTaskGroup(of: (String, ElectronResult?).self) { group in
      for app in electronApps {
        group.addTask {
          let result = await self.check(
            updateUrl: app.electronUpdateUrl!,
            provider: app.electronUpdateProvider,
            installedVersion: app.version
          )
          return (app.id, result)
        }
      }

      var results: [String: ElectronResult] = [:]
      for await (appId, result) in group {
        if let result {
          results[appId] = result
        }
      }

      Logger.electron.info(
        "Electron checks complete: \(results.count)/\(electronApps.count) succeeded")
      return results
    }
  }

  /// Checks a single Electron app's update feed.
  func check(
    updateUrl: String,
    provider: String?,
    installedVersion: String?
  ) async -> ElectronResult? {
    switch provider {
    case "github":
      return await checkGitHub(updateUrl: updateUrl)
    case "generic":
      return await checkGeneric(updateUrl: updateUrl)
    default:
      return nil
    }
  }

  // MARK: - GitHub provider

  /// Fetches the latest release from the GitHub API.
  private func checkGitHub(updateUrl: String) async -> ElectronResult? {
    // Convert https://github.com/{owner}/{repo}/releases to API URL
    guard let (owner, repo) = parseGitHubOwnerRepo(from: updateUrl) else { return nil }
    let apiUrl = "https://api.github.com/repos/\(owner)/\(repo)/releases/latest"

    guard let url = URL(string: apiUrl) else { return nil }

    var request = URLRequest(url: url)
    request.setValue("application/vnd.github.v3+json", forHTTPHeaderField: "Accept")
    request.setValue("Versioneer/1.0", forHTTPHeaderField: "User-Agent")

    do {
      let (data, response) = try await session.data(for: request)

      guard let httpResponse = response as? HTTPURLResponse,
        httpResponse.statusCode == 200
      else { return nil }

      guard let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
        return nil
      }

      let tagName = json["tag_name"] as? String
      let version = tagName.map { stripVersionPrefix($0) }
      let publishedAt = json["published_at"] as? String

      // Find a macOS-relevant asset
      let downloadUrl: String? =
        if let assets = json["assets"] as? [[String: Any]] {
          findMacAssetUrl(in: assets)
        } else {
          nil
        }

      return ElectronResult(
        latestVersion: version,
        downloadUrl: downloadUrl,
        publishedAt: publishedAt
      )
    } catch {
      Logger.electron.debug(
        "Failed to fetch GitHub release for \(updateUrl): \(error.localizedDescription)")
      return nil
    }
  }

  /// Parses `owner` and `repo` from a GitHub URL.
  private func parseGitHubOwnerRepo(from urlString: String) -> (String, String)? {
    guard let url = URL(string: urlString),
      url.host == "github.com" || url.host == "www.github.com"
    else { return nil }

    let components = url.pathComponents.filter { $0 != "/" }
    guard components.count >= 2 else { return nil }
    return (components[0], components[1])
  }

  /// Strips common version prefixes like "v" or "V".
  private func stripVersionPrefix(_ tag: String) -> String {
    var s = tag
    if s.hasPrefix("v") || s.hasPrefix("V") {
      s = String(s.dropFirst())
    }
    return s
  }

  /// Finds a macOS-relevant download URL from GitHub release assets, preferring the local architecture.
  private func findMacAssetUrl(in assets: [[String: Any]]) -> String? {
    let macKeywords = ["mac", "darwin", "osx", "macos"]
    let macExtensions = [".dmg", ".zip", ".pkg"]

    #if arch(arm64)
      let preferredArchKeywords = ["arm64", "aarch64", "apple-silicon", "silicon"]
      let otherArchKeywords = ["x86_64", "amd64", "intel", "x64"]
    #else
      let preferredArchKeywords = ["x86_64", "amd64", "intel", "x64"]
      let otherArchKeywords = ["arm64", "aarch64", "apple-silicon", "silicon"]
    #endif

    struct ScoredAsset {
      let url: String
      let score: Int  // Higher = better match
    }

    var candidates: [ScoredAsset] = []

    for asset in assets {
      guard let name = (asset["name"] as? String)?.lowercased(),
        let url = asset["browser_download_url"] as? String
      else { continue }

      let hasMacKeyword = macKeywords.contains { name.contains($0) }
      let hasMacExtension = macExtensions.contains { name.hasSuffix($0) }
      guard hasMacExtension else { continue }

      let hasPreferredArch = preferredArchKeywords.contains { name.contains($0) }
      let hasOtherArch = otherArchKeywords.contains { name.contains($0) }
      let isUniversal = name.contains("universal")

      // Score: prefer arch match > universal > no arch specified > wrong arch
      let score: Int
      if hasPreferredArch {
        score = 4
      } else if isUniversal {
        score = 3
      } else if hasMacKeyword && !hasOtherArch {
        score = 2
      } else if !hasOtherArch {
        score = 1
      } else {
        score = 0
      }

      if score > 0 {
        candidates.append(ScoredAsset(url: url, score: score))
      }
    }

    return candidates.max(by: { $0.score < $1.score })?.url
  }

  // MARK: - Generic provider

  /// Fetches `latest-mac.yml` from a generic update server.
  private func checkGeneric(updateUrl: String) async -> ElectronResult? {
    // electron-builder generic servers host latest-mac.yml at the base URL
    let feedUrl =
      updateUrl.hasSuffix("/")
      ? "\(updateUrl)latest-mac.yml"
      : "\(updateUrl)/latest-mac.yml"

    guard let url = URL(string: feedUrl) else { return nil }

    var request = URLRequest(url: url)
    request.setValue("Versioneer/1.0", forHTTPHeaderField: "User-Agent")

    do {
      let (data, response) = try await session.data(for: request)

      guard let httpResponse = response as? HTTPURLResponse,
        httpResponse.statusCode == 200,
        let body = String(data: data, encoding: .utf8)
      else { return nil }

      return parseLatestMacYml(body)
    } catch {
      Logger.electron.debug(
        "Failed to fetch latest-mac.yml from \(feedUrl): \(error.localizedDescription)")
      return nil
    }
  }

  /// Parses electron-builder's `latest-mac.yml` format.
  private func parseLatestMacYml(_ yaml: String) -> ElectronResult? {
    var version: String?
    var releaseDate: String?

    for line in yaml.split(separator: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      if trimmed.hasPrefix("version:") {
        version = String(trimmed.dropFirst("version:".count)).trimmingCharacters(in: .whitespaces)
      } else if trimmed.hasPrefix("releaseDate:") {
        releaseDate = String(trimmed.dropFirst("releaseDate:".count))
          .trimmingCharacters(in: .whitespaces)
          .trimmingCharacters(in: CharacterSet(charactersIn: "'\""))
      }
    }

    guard let version else { return nil }

    return ElectronResult(
      latestVersion: version,
      downloadUrl: nil,
      publishedAt: releaseDate
    )
  }
}
