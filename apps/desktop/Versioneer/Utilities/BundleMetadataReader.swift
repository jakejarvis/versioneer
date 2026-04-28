import CoreServices
import Foundation
import Security

/// Private CoreFoundation function that flushes NSBundle's cached properties.
/// Without this, after an in-place app update (e.g., Sparkle), Bundle.infoDictionary
/// returns stale version info from the pre-update binary.
@_silgen_name("_CFBundleFlushBundleCaches")
private nonisolated func _CFBundleFlushBundleCaches(_ bundle: CFBundle?)

/// Extracts metadata from an app bundle on disk.
nonisolated enum BundleMetadataReader {
  /// Reads an `InstalledApp` from a `.app` bundle URL.
  /// Returns `nil` if the bundle cannot be loaded or has no usable name.
  nonisolated static func readApp(at url: URL) -> InstalledApp? {
    guard let bundle = Bundle(url: url) else { return nil }

    // Flush CoreFoundation's bundle cache to ensure we read current version info.
    // NSBundle caches infoDictionary aggressively — stale after in-place updates.
    let cfBundle = CFBundleCreate(kCFAllocatorDefault, bundle.bundleURL as CFURL)
    _CFBundleFlushBundleCaches(cfBundle)

    let info = bundle.infoDictionary ?? [:]

    let name =
      (info["CFBundleDisplayName"] as? String)
      ?? (info["CFBundleName"] as? String)
      ?? url.deletingPathExtension().lastPathComponent

    let bundleId = info["CFBundleIdentifier"] as? String
    let version = info["CFBundleShortVersionString"] as? String
    let buildNumber = info["CFBundleVersion"] as? String

    let signingInfo = readCodeSigningInfo(at: url)
    let sparkleInfo = readSparkleInfo(from: bundle, info: info, bundleId: bundleId)
    let isMasApp = masReceiptExists(in: bundle)
    let electronInfo = readElectronInfo(from: bundle)
    let homebrewInfo = detectHomebrewInstall(at: url)

    return InstalledApp(
      name: name,
      bundleId: bundleId,
      version: version,
      buildNumber: buildNumber,
      teamId: signingInfo.teamId,
      path: url.path,
      architecture: readArchitecture(from: bundle),
      sparkleFeedUrl: sparkleInfo.feedUrl,
      sparklePublicKey: sparkleInfo.publicKey,
      isSparkleApp: sparkleInfo.hasSparkle,
      isMasApp: isMasApp,
      masAppId: isMasApp ? readSpotlightAdamID(at: url) : nil,
      isElectronApp: electronInfo.isElectron,
      electronUpdateProvider: electronInfo.provider,
      electronUpdateUrl: electronInfo.updateUrl,
      codeSigningAuthority: signingInfo.authority,
      appCategory: info["LSApplicationCategoryType"] as? String,
      minMacOSVersion: info["LSMinimumSystemVersion"] as? String,
      isHomebrewInstalled: homebrewInfo.isHomebrew,
      homebrewCaskToken: homebrewInfo.caskToken
    )
  }

  // MARK: - Homebrew Cask detection

  private struct HomebrewInfo {
    let isHomebrew: Bool
    let caskToken: String?
  }

  /// Detects if an app was installed via Homebrew by resolving symlinks.
  /// Homebrew Cask apps in /Applications are symlinks to
  /// /opt/homebrew/Caskroom/{token}/{version}/App.app (Apple Silicon) or
  /// /usr/local/Caskroom/{token}/{version}/App.app (Intel).
  nonisolated private static func detectHomebrewInstall(at url: URL) -> HomebrewInfo {
    let resolved = url.resolvingSymlinksInPath()
    let resolvedPath = resolved.path

    // Check if the resolved path goes through a Caskroom directory
    guard let caskroomRange = resolvedPath.range(of: "/Caskroom/") else {
      return HomebrewInfo(isHomebrew: false, caskToken: nil)
    }

    // Extract the cask token: path after /Caskroom/ up to the next /
    let afterCaskroom = resolvedPath[caskroomRange.upperBound...]
    let token = afterCaskroom.prefix(while: { $0 != "/" })
    let caskToken = token.isEmpty ? nil : String(token)

    return HomebrewInfo(isHomebrew: true, caskToken: caskToken)
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

  /// Returns the URL string only if it parses as a web URL.
  /// Filters out relative paths, placeholder tokens, local file URLs, and garbage strings.
  nonisolated private static func validatedUrl(_ raw: String?) -> String? {
    guard let raw, !raw.isEmpty else { return nil }
    guard let url = URL(string: raw),
      let scheme = url.scheme?.lowercased(),
      scheme == "http" || scheme == "https",
      url.host != nil
    else { return nil }
    return raw
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
      let unquoted =
        trimmed
        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
      if let url = validatedUrl(unquoted) {
        return url
      }
    }

    // Sparkle persists the feed URL to the app's user defaults after first use.
    // This catches apps that set the URL programmatically rather than in Info.plist.
    if let bundleId,
      let defaults = UserDefaults(suiteName: bundleId),
      let raw = defaults.string(forKey: "SUFeedURL"),
      !raw.isEmpty
    {
      let trimmed = raw.trimmingCharacters(in: .whitespaces)
      let unquoted =
        trimmed
        .trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
      if let url = validatedUrl(unquoted) {
        return url
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
    guard let contents = try? FileManager.default.contentsOfDirectory(atPath: frameworksDir.path)
    else {
      return false
    }
    return contents.contains { $0.contains("DevMateKit") }
  }

  // MARK: - Mac App Store

  /// Checks for the MAS receipt file that Apple embeds in all App Store apps.
  nonisolated private static func masReceiptExists(in bundle: Bundle) -> Bool {
    let receiptPath = bundle.bundleURL
      .appendingPathComponent("Contents/_MASReceipt/receipt")
    return FileManager.default.fileExists(atPath: receiptPath.path)
  }

  /// Reads the App Store Adam ID from Spotlight metadata.
  /// Returns nil if the app is not indexed or has no Adam ID.
  nonisolated private static func readSpotlightAdamID(at url: URL) -> String? {
    guard let mdItem = MDItemCreateWithURL(kCFAllocatorDefault, url as CFURL) else { return nil }
    guard let adamID = MDItemCopyAttribute(mdItem, "kMDItemAppStoreAdamID" as CFString)
    else { return nil }
    if let number = adamID as? NSNumber {
      let intValue = number.int64Value
      guard intValue > 0 else { return nil }
      return String(intValue)
    }
    return nil
  }

  // MARK: - Electron

  private struct ElectronInfo {
    let isElectron: Bool
    let provider: String?
    let updateUrl: String?
  }

  nonisolated private static func readElectronInfo(from bundle: Bundle) -> ElectronInfo {
    let frameworkPath = bundle.bundleURL
      .appendingPathComponent("Contents/Frameworks/Electron Framework.framework")
    guard FileManager.default.fileExists(atPath: frameworkPath.path) else {
      return ElectronInfo(isElectron: false, provider: nil, updateUrl: nil)
    }

    // Try to read app-update.yml from Resources
    let ymlPath = bundle.bundleURL
      .appendingPathComponent("Contents/Resources/app-update.yml")
    guard let ymlData = FileManager.default.contents(atPath: ymlPath.path),
      let ymlString = String(data: ymlData, encoding: .utf8)
    else {
      return ElectronInfo(isElectron: true, provider: nil, updateUrl: nil)
    }

    let config = parseSimpleYaml(ymlString)
    let provider = config["provider"]
    let updateUrl = resolveElectronUpdateUrl(provider: provider, config: config)

    return ElectronInfo(isElectron: true, provider: provider, updateUrl: updateUrl)
  }

  /// Resolves the update feed URL from electron-builder's app-update.yml config.
  nonisolated private static func resolveElectronUpdateUrl(
    provider: String?,
    config: [String: String]
  ) -> String? {
    switch provider {
    case "github":
      guard let owner = config["owner"], let repo = config["repo"] else { return nil }
      return validatedUrl("https://github.com/\(owner)/\(repo)/releases")
    case "generic":
      return validatedUrl(config["url"])
    default:
      return nil
    }
  }

  /// Parses a flat YAML file (key: value per line) into a dictionary.
  /// Handles the simple format used by electron-builder's app-update.yml.
  nonisolated private static func parseSimpleYaml(_ yaml: String) -> [String: String] {
    var result: [String: String] = [:]
    for line in yaml.split(separator: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard !trimmed.hasPrefix("#"), !trimmed.isEmpty else { continue }
      guard let colonIndex = trimmed.firstIndex(of: ":") else { continue }
      let key = String(trimmed[trimmed.startIndex..<colonIndex]).trimmingCharacters(
        in: .whitespaces)
      let value = String(trimmed[trimmed.index(after: colonIndex)...]).trimmingCharacters(
        in: .whitespaces)
      if !key.isEmpty, !value.isEmpty {
        result[key] = value
      }
    }
    return result
  }

  // MARK: - Architecture

  private static let cpuTypeARM64: Int = 0x0100_000c
  private static let cpuTypeX86_64: Int = 0x0100_0007

  /// Reads executable architectures from the bundle's Mach-O header.
  nonisolated private static func readArchitecture(from bundle: Bundle) -> String? {
    guard let archs = bundle.executableArchitectures else { return nil }
    let archSet = Set(archs.map(\.intValue))

    let hasArm64 = archSet.contains(cpuTypeARM64)
    let hasX86_64 = archSet.contains(cpuTypeX86_64)

    if hasArm64 && hasX86_64 { return "universal" }
    if hasArm64 { return "arm64" }
    if hasX86_64 { return "x86_64" }
    return nil
  }

  // MARK: - Code Signing

  private struct CodeSigningInfo {
    let teamId: String?
    let authority: String?
  }

  /// Reads team ID and signing authority from the app's code signature.
  nonisolated private static func readCodeSigningInfo(at url: URL) -> CodeSigningInfo {
    var staticCode: SecStaticCode?
    guard SecStaticCodeCreateWithPath(url as CFURL, [], &staticCode) == errSecSuccess,
      let code = staticCode
    else {
      return CodeSigningInfo(teamId: nil, authority: nil)
    }

    var info: CFDictionary?
    guard
      SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &info)
        == errSecSuccess,
      let dict = info as? [String: Any]
    else {
      return CodeSigningInfo(teamId: nil, authority: nil)
    }

    let teamId = dict[kSecCodeInfoTeamIdentifier as String] as? String

    // Extract the signing authority (CN) from the leaf certificate
    var authority: String?
    if let certs = dict[kSecCodeInfoCertificates as String] as? [SecCertificate],
      let leafCert = certs.first
    {
      var commonName: CFString?
      if SecCertificateCopyCommonName(leafCert, &commonName) == errSecSuccess {
        authority = commonName as String?
      }
    }

    return CodeSigningInfo(teamId: teamId, authority: authority)
  }
}
