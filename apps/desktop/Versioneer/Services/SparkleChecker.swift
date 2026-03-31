import Foundation
import Logging

/// Fetches and parses Sparkle appcast feeds locally to determine the latest available version.
actor SparkleChecker {

  /// The result of checking a single Sparkle feed.
  struct SparkleResult: Sendable {
    let feedUrl: String
    let latestVersion: String?
    let latestBuildNumber: String?
    let publishedAt: String?
    let releaseNotesUrl: String?
    let downloadUrl: String?
    let minOsVersion: String?
  }

  private let session: URLSession

  init() {
    let config = URLSessionConfiguration.ephemeral
    config.timeoutIntervalForRequest = 15
    config.timeoutIntervalForResource = 30
    config.httpAdditionalHeaders = [
      "Accept": "application/rss+xml,*/*;q=0.1"
    ]
    self.session = URLSession(configuration: config)
  }

  /// Checks a Sparkle appcast feed and returns the latest applicable release.
  func check(
    feedUrl: String,
    appName: String?,
    installedVersion: String?
  ) async -> SparkleResult? {
    guard var url = URL(string: feedUrl) else {
      Logger.sparkle.warning("Invalid feed URL: \(feedUrl)")
      return nil
    }

    // Append minimal system parameters that some feeds use to filter items
    url = appendQueryParameters(to: url, installedVersion: installedVersion)

    var request = URLRequest(url: url)
    let versioneerVersion =
      Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    let userAgent =
      "\(appName ?? "Unknown")/\(installedVersion ?? "0") Sparkle/2 Versioneer/\(versioneerVersion)"
    request.setValue(userAgent, forHTTPHeaderField: "User-Agent")

    do {
      let (data, response) = try await session.data(for: request)

      guard let httpResponse = response as? HTTPURLResponse else {
        Logger.sparkle.warning("Non-HTTP response for \(feedUrl)")
        return nil
      }

      guard httpResponse.statusCode == 200 else {
        Logger.sparkle.debug("Feed returned \(httpResponse.statusCode): \(feedUrl)")
        return nil
      }

      guard let body = String(data: data, encoding: .utf8) else {
        Logger.sparkle.warning("Could not decode feed body as UTF-8: \(feedUrl)")
        return nil
      }

      return parseAppcast(body, feedUrl: feedUrl)
    } catch {
      Logger.sparkle.debug("Failed to fetch \(feedUrl): \(error.localizedDescription)")
      return nil
    }
  }

  /// Checks multiple apps with Sparkle feeds concurrently, returning results keyed by bundle ID or path.
  func checkAll(apps: [InstalledApp]) async -> [String: SparkleResult] {
    let sparkleApps = apps.filter { $0.sparkleFeedUrl != nil }
    guard !sparkleApps.isEmpty else { return [:] }

    Logger.sparkle.info("Checking \(sparkleApps.count) Sparkle feeds locally")

    return await withTaskGroup(of: (String, SparkleResult?).self) { group in
      for app in sparkleApps {
        group.addTask {
          let result = await self.check(
            feedUrl: app.sparkleFeedUrl!,
            appName: app.name,
            installedVersion: app.version
          )
          return (app.id, result)
        }
      }

      var results: [String: SparkleResult] = [:]
      for await (appId, result) in group {
        if let result {
          results[appId] = result
        }
      }

      Logger.sparkle.info(
        "Sparkle checks complete: \(results.count)/\(sparkleApps.count) succeeded")
      return results
    }
  }

  // MARK: - Appcast parsing

  /// Parses a Sparkle appcast XML body and returns the latest applicable release.
  private func parseAppcast(_ body: String, feedUrl: String) -> SparkleResult? {
    let items = parseItems(from: body)
    guard !items.isEmpty else { return nil }

    let osVersion = ProcessInfo.processInfo.operatingSystemVersion
    let osVersionString =
      "\(osVersion.majorVersion).\(osVersion.minorVersion).\(osVersion.patchVersion)"

    // Filter to items compatible with the current OS
    let currentOs = Version(osVersionString)
    let applicable = items.filter { item in
      guard let minOs = item.minOsVersion else { return true }
      return currentOs.isAtLeast(Version(minOs))
    }

    // Sort by version descending and take the newest (handles out-of-order feeds)
    guard let latest = applicable.sorted(by: { item1, item2 in
      let v1 = Version(item1.shortVersionString ?? item1.version ?? "")
      let v2 = Version(item2.shortVersionString ?? item2.version ?? "")
      return v1 > v2
    }).first else { return nil }

    let bestEnclosure = latest.bestEnclosure

    return SparkleResult(
      feedUrl: feedUrl,
      latestVersion: latest.shortVersionString ?? latest.version,
      latestBuildNumber: latest.version,
      publishedAt: latest.pubDate,
      releaseNotesUrl: latest.releaseNotesUrl,
      downloadUrl: bestEnclosure?.url,
      minOsVersion: bestEnclosure?.minOsVersion ?? latest.minOsVersion
    )
  }

  private struct Enclosure {
    let url: String
    let minOsVersion: String?
  }

  private struct AppcastItem {
    let shortVersionString: String?
    let version: String?
    let pubDate: String?
    let releaseNotesUrl: String?
    let enclosures: [Enclosure]
    let minOsVersion: String?

    var downloadUrl: String? { bestEnclosure?.url }

    /// Picks the best enclosure for the local architecture.
    var bestEnclosure: Enclosure? {
      guard enclosures.count > 1 else { return enclosures.first }

      #if arch(arm64)
        let preferredKeywords = ["arm64", "aarch64", "apple-silicon", "silicon"]
      #else
        let preferredKeywords = ["x86_64", "amd64", "intel"]
      #endif

      // Prefer architecture-matched URL, then universal, then first
      if let match = enclosures.first(where: { enc in
        let lower = enc.url.lowercased()
        return preferredKeywords.contains { lower.contains($0) }
      }) {
        return match
      }

      if let universal = enclosures.first(where: { $0.url.lowercased().contains("universal") }) {
        return universal
      }

      return enclosures.first
    }
  }

  private func parseItems(from xml: String) -> [AppcastItem] {
    // Extract <item> blocks via regex, matching the server-side parser approach
    let itemPattern = try! NSRegularExpression(
      pattern: "<item>(.*?)</item>", options: [.dotMatchesLineSeparators, .caseInsensitive])
    let range = NSRange(xml.startIndex..., in: xml)

    return itemPattern.matches(in: xml, range: range).compactMap { match in
      guard let itemRange = Range(match.range(at: 1), in: xml) else { return nil }
      let itemXml = String(xml[itemRange])
      return parseItem(itemXml)
    }
  }

  private func parseItem(_ xml: String) -> AppcastItem? {
    let shortVersion =
      extractTag(xml, "sparkle:shortVersionString")
      ?? extractEnclosureAttr(xml, "sparkle:shortVersionString")
    let version =
      extractTag(xml, "sparkle:version")
      ?? extractEnclosureAttr(xml, "sparkle:version")

    // Must have at least one version identifier
    guard shortVersion != nil || version != nil else { return nil }

    let pubDate = extractTag(xml, "pubDate")
    let releaseNotesUrl = extractTag(xml, "sparkle:releaseNotesLink")
    let minOsVersion = extractTag(xml, "sparkle:minimumSystemVersion")

    // Extract all enclosures
    let enclosures = extractAllEnclosures(from: xml)

    return AppcastItem(
      shortVersionString: shortVersion,
      version: version,
      pubDate: pubDate,
      releaseNotesUrl: releaseNotesUrl,
      enclosures: enclosures,
      minOsVersion: minOsVersion ?? enclosures.first?.minOsVersion
    )
  }

  /// Extracts all `<enclosure>` elements from an item's XML.
  private func extractAllEnclosures(from xml: String) -> [Enclosure] {
    let pattern = try! NSRegularExpression(
      pattern: "<enclosure\\s([^>]*?)/?>",
      options: [.caseInsensitive]
    )
    let range = NSRange(xml.startIndex..., in: xml)

    return pattern.matches(in: xml, range: range).compactMap { match in
      guard let attrsRange = Range(match.range(at: 1), in: xml) else { return nil }
      let attrs = String(xml[attrsRange])
      guard let url = extractAttrValue(attrs, "url") else { return nil }
      let minOs = extractAttrValue(attrs, "sparkle:minimumSystemVersion")
      return Enclosure(url: url, minOsVersion: minOs)
    }
  }

  // MARK: - XML helpers

  private func extractTag(_ xml: String, _ tag: String) -> String? {
    // Try CDATA first, then plain text content
    let patterns = [
      "<\(tag)[^>]*><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></\(tag)>",
      "<\(tag)[^>]*>([^<]*)</\(tag)>",
    ]
    for pattern in patterns {
      if let regex = try? NSRegularExpression(
        pattern: pattern, options: [.caseInsensitive, .dotMatchesLineSeparators]),
        let match = regex.firstMatch(in: xml, range: NSRange(xml.startIndex..., in: xml)),
        let range = Range(match.range(at: 1), in: xml)
      {
        let value = String(xml[range]).trimmingCharacters(in: .whitespacesAndNewlines)
        if !value.isEmpty { return value }
      }
    }
    return nil
  }

  private func extractEnclosureAttr(_ xml: String, _ attr: String) -> String? {
    let enclosurePattern = try! NSRegularExpression(
      pattern: "<enclosure\\s([^>]*?)/?>",
      options: [.caseInsensitive]
    )
    guard
      let encMatch = enclosurePattern.firstMatch(
        in: xml, range: NSRange(xml.startIndex..., in: xml)),
      let attrsRange = Range(encMatch.range(at: 1), in: xml)
    else { return nil }

    let attrs = String(xml[attrsRange])
    return extractAttrValue(attrs, attr)
  }

  private func extractAttrValue(_ attrs: String, _ name: String) -> String? {
    let pattern =
      "\(NSRegularExpression.escapedPattern(for: name))\\s*=\\s*(?:\"([^\"]*)\"|'([^']*)')"
    guard let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]),
      let match = regex.firstMatch(in: attrs, range: NSRange(attrs.startIndex..., in: attrs))
    else { return nil }

    if let r1 = Range(match.range(at: 1), in: attrs), !attrs[r1].isEmpty {
      return String(attrs[r1])
    }
    if let r2 = Range(match.range(at: 2), in: attrs), !attrs[r2].isEmpty {
      return String(attrs[r2])
    }
    return nil
  }

  // MARK: - Helpers

  private func appendQueryParameters(to url: URL, installedVersion: String?) -> URL {
    guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
      return url
    }
    var items = components.queryItems ?? []

    let osVersion = ProcessInfo.processInfo.operatingSystemVersion
    items.append(
      URLQueryItem(
        name: "osVersion",
        value: "\(osVersion.majorVersion).\(osVersion.minorVersion).\(osVersion.patchVersion)"))

    if let installedVersion {
      items.append(URLQueryItem(name: "appVersion", value: installedVersion))
    }

    components.queryItems = items
    return components.url ?? url
  }

}
