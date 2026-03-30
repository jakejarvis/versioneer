import Foundation
import Observation

/// Persists lightweight user settings using UserDefaults.
@Observable
@MainActor
final class SettingsStore {
  private let defaults: UserDefaults

  private enum Keys {
    static let baseURL = "versioneer_base_url"
    static let scanOnLaunch = "versioneer_scan_on_launch"
    static let ignoredAppRules = "versioneer_ignored_app_rules"
    static let defaultChannel = "versioneer_default_channel"
    static let perAppChannels = "versioneer_per_app_channels"
    static let extraScanRoots = "versioneer_extra_scan_roots"
    static let masCliPath = "versioneer_mas_cli_path"
  }

  static let defaultBaseURL = URL(string: "https://api.versioneer.app")!

  init(defaults: UserDefaults = .standard) {
    self.defaults = defaults
  }

  var baseURL: URL {
    get {
      if let string = defaults.string(forKey: Keys.baseURL),
        let url = URL(string: string)
      {
        return url
      }
      return Self.defaultBaseURL
    }
    set {
      defaults.set(newValue.absoluteString, forKey: Keys.baseURL)
    }
  }

  var scanOnLaunch: Bool {
    get {
      if defaults.object(forKey: Keys.scanOnLaunch) == nil { return true }
      return defaults.bool(forKey: Keys.scanOnLaunch)
    }
    set {
      defaults.set(newValue, forKey: Keys.scanOnLaunch)
    }
  }

  var ignoredAppRules: [IgnoredAppRule] {
    get {
      guard let data = defaults.data(forKey: Keys.ignoredAppRules) else { return [] }

      do {
        let decoded = try JSONDecoder().decode([IgnoredAppRule].self, from: data)
        return sortAndDeduplicate(decoded)
      } catch {
        return []
      }
    }
    set {
      let sanitized = sortAndDeduplicate(newValue)

      if sanitized.isEmpty {
        defaults.removeObject(forKey: Keys.ignoredAppRules)
        return
      }

      do {
        let data = try JSONEncoder().encode(sanitized)
        defaults.set(data, forKey: Keys.ignoredAppRules)
      } catch {
        defaults.removeObject(forKey: Keys.ignoredAppRules)
      }
    }
  }

  func addIgnoredAppRule(_ rule: IgnoredAppRule) {
    ignoredAppRules = ignoredAppRules + [rule]
  }

  func removeIgnoredAppRule(_ rule: IgnoredAppRule) {
    ignoredAppRules = ignoredAppRules.filter { $0.id != rule.id }
  }

  func isIgnored(_ app: InstalledApp) -> Bool {
    ignoredAppRules.contains { $0.matches(app) }
  }

  var defaultChannel: String {
    get { defaults.string(forKey: Keys.defaultChannel) ?? "stable" }
    set { defaults.set(newValue, forKey: Keys.defaultChannel) }
  }

  var perAppChannels: [String: String] {
    get {
      guard let data = defaults.data(forKey: Keys.perAppChannels) else { return [:] }
      return (try? JSONDecoder().decode([String: String].self, from: data)) ?? [:]
    }
    set {
      if newValue.isEmpty {
        defaults.removeObject(forKey: Keys.perAppChannels)
      } else if let data = try? JSONEncoder().encode(newValue) {
        defaults.set(data, forKey: Keys.perAppChannels)
      }
    }
  }

  func setChannel(_ channel: String, forAppId appId: String) {
    var current = perAppChannels
    current[appId] = channel
    perAppChannels = current
  }

  func removeChannelOverride(forAppId appId: String) {
    var current = perAppChannels
    current.removeValue(forKey: appId)
    perAppChannels = current
  }

  func channel(forAppId appId: String) -> String {
    perAppChannels[appId] ?? defaultChannel
  }

  /// Extra scan roots beyond the default `/Applications` and `~/Applications`.
  var extraScanRoots: [String] {
    get {
      defaults.stringArray(forKey: Keys.extraScanRoots) ?? []
    }
    set {
      var seen = Set<String>()
      let deduplicated = newValue.filter { seen.insert($0).inserted }
      if deduplicated.isEmpty {
        defaults.removeObject(forKey: Keys.extraScanRoots)
      } else {
        defaults.set(deduplicated, forKey: Keys.extraScanRoots)
      }
    }
  }

  func addExtraScanRoot(_ path: String) {
    let trimmed = path.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmed.isEmpty, trimmed.hasPrefix("/") else { return }
    var current = extraScanRoots
    guard !current.contains(trimmed) else { return }
    current.append(trimmed)
    extraScanRoots = current
  }

  func removeExtraScanRoot(_ path: String) {
    extraScanRoots = extraScanRoots.filter { $0 != path }
  }

  /// All scan root URLs: default roots plus user-configured extras.
  var allScanRootURLs: [URL] {
    var urls: [URL] = [
      URL(fileURLWithPath: "/Applications"),
    ]
    if let home = FileManager.default.homeDirectoryForCurrentUser as URL? {
      urls.append(home.appendingPathComponent("Applications"))
    }
    for extra in extraScanRoots {
      let url = URL(fileURLWithPath: extra)
      if !urls.contains(url) {
        urls.append(url)
      }
    }
    return urls
  }

  // MARK: - mas-cli

  /// User-provided override for the mas-cli binary path. When nil, auto-detection is used.
  var masCliPathOverride: String? {
    get { defaults.string(forKey: Keys.masCliPath) }
    set {
      if let newValue, !newValue.isEmpty {
        defaults.set(newValue, forKey: Keys.masCliPath)
      } else {
        defaults.removeObject(forKey: Keys.masCliPath)
      }
    }
  }

  /// Resolved path to the mas binary: user override first, then well-known locations.
  var resolvedMasCliPath: String? {
    if let override = masCliPathOverride,
      FileManager.default.isExecutableFile(atPath: override)
    {
      return override
    }
    let candidates = ["/opt/homebrew/bin/mas", "/usr/local/bin/mas"]
    return candidates.first { FileManager.default.isExecutableFile(atPath: $0) }
  }

  /// Whether mas-cli is available at any resolved path.
  var isMasCliAvailable: Bool {
    resolvedMasCliPath != nil
  }

  /// Resets the base URL to the default value.
  func resetBaseURL() {
    defaults.removeObject(forKey: Keys.baseURL)
  }

  private func sortAndDeduplicate(_ rules: [IgnoredAppRule]) -> [IgnoredAppRule] {
    var uniqueRules: [String: IgnoredAppRule] = [:]
    for rule in rules where uniqueRules[rule.id] == nil {
      uniqueRules[rule.id] = rule
    }

    return uniqueRules.values.sorted { lhs, rhs in
      if lhs.displayName != rhs.displayName {
        return lhs.displayName.localizedStandardCompare(rhs.displayName) == .orderedAscending
      }
      return lhs.id < rhs.id
    }
  }
}
