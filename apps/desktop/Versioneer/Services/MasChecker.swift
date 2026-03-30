import Foundation
import Logging

/// Checks for available Mac App Store updates using the mas-cli tool.
/// Returns empty results if mas is not installed or not signed in — the feature degrades silently.
actor MasChecker {
  struct MasAppInfo: Sendable {
    let masAppId: String
    /// The latest available version from `mas outdated`, or nil if up to date.
    let latestVersion: String?
  }

  struct MasListEntry: Sendable {
    let appId: String
    let appName: String
    let version: String
  }

  struct MasOutdatedEntry: Sendable {
    let appId: String
    let newVersion: String
  }

  /// Checks all MAS-installed apps for available updates.
  /// Returns a dictionary keyed by `InstalledApp.id`.
  func checkAll(
    apps: [InstalledApp],
    masCliPath: String?
  ) async -> [String: MasAppInfo] {
    guard let masPath = masCliPath else { return [:] }

    let masApps = apps.filter(\.isMasApp)
    guard !masApps.isEmpty else { return [:] }

    // Run mas list and mas outdated in parallel
    async let listTask = runMasList(masPath: masPath)
    async let outdatedTask = runMasOutdated(masPath: masPath)

    let listEntries = await listTask
    let outdatedEntries = await outdatedTask

    // Build lookup: app ID → outdated new version
    let outdatedByAppId = Dictionary(
      outdatedEntries.map { ($0.appId, $0.newVersion) },
      uniquingKeysWith: { first, _ in first }
    )

    // Match installed apps to mas list entries by name
    var results: [String: MasAppInfo] = [:]
    for app in masApps {
      guard let masAppId = matchMasAppId(for: app, in: listEntries) else { continue }
      results[app.id] = MasAppInfo(
        masAppId: masAppId,
        latestVersion: outdatedByAppId[masAppId]
      )
    }

    return results
  }

  // MARK: - mas list

  /// Runs `mas list` and parses the output.
  private func runMasList(masPath: String) async -> [MasListEntry] {
    guard let result = await runWithTimeout(masPath: masPath, arguments: ["list"], timeoutSeconds: 30)
    else {
      Logger.mas.warning("mas list timed out")
      return []
    }

    guard result.terminationStatus == 0 else {
      Logger.mas.warning(
        "mas list exited with status \(result.terminationStatus): \(result.stderr)")
      return []
    }

    return parseMasList(result.stdout)
  }

  /// Parses `mas list` output. Each line: `<id> <name> (<version>)`
  nonisolated func parseMasList(_ output: String) -> [MasListEntry] {
    var entries: [MasListEntry] = []
    for line in output.split(separator: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard !trimmed.isEmpty else { continue }
      guard let entry = parseMasListLine(trimmed) else { continue }
      entries.append(entry)
    }
    return entries
  }

  /// Parses a single `mas list` line: `497799835 Xcode (15.4)`
  nonisolated private func parseMasListLine(_ line: String) -> MasListEntry? {
    // Find the numeric ID prefix
    let scanner = Scanner(string: line)
    guard let appId = scanner.scanCharacters(from: .decimalDigits),
      !appId.isEmpty
    else { return nil }

    let remainder = String(line[line.index(line.startIndex, offsetBy: appId.count)...])
      .trimmingCharacters(in: .whitespaces)

    // Find the last occurrence of "(" to extract the version
    guard let lastOpenParen = remainder.lastIndex(of: "("),
      let lastCloseParen = remainder.lastIndex(of: ")"),
      lastCloseParen > lastOpenParen
    else { return nil }

    let appName = String(remainder[remainder.startIndex..<lastOpenParen])
      .trimmingCharacters(in: .whitespaces)
    let version = String(
      remainder[remainder.index(after: lastOpenParen)..<lastCloseParen]
    ).trimmingCharacters(in: .whitespaces)

    guard !appName.isEmpty, !version.isEmpty else { return nil }
    return MasListEntry(appId: appId, appName: appName, version: version)
  }

  // MARK: - mas outdated

  /// Runs `mas outdated` and parses the output.
  private func runMasOutdated(masPath: String) async -> [MasOutdatedEntry] {
    guard
      let result = await runWithTimeout(
        masPath: masPath, arguments: ["outdated"], timeoutSeconds: 60)
    else {
      Logger.mas.warning("mas outdated timed out")
      return []
    }

    guard result.terminationStatus == 0 else {
      Logger.mas.warning(
        "mas outdated exited with status \(result.terminationStatus): \(result.stderr)")
      return []
    }

    return parseMasOutdated(result.stdout)
  }

  /// Parses `mas outdated` output. Each line: `<id> <name> (<current> -> <new>)`
  nonisolated func parseMasOutdated(_ output: String) -> [MasOutdatedEntry] {
    var entries: [MasOutdatedEntry] = []
    for line in output.split(separator: "\n") {
      let trimmed = line.trimmingCharacters(in: .whitespaces)
      guard !trimmed.isEmpty else { continue }
      guard let entry = parseMasOutdatedLine(trimmed) else { continue }
      entries.append(entry)
    }
    return entries
  }

  /// Parses a single `mas outdated` line: `497799835 Xcode (15.4 -> 16.0)`
  nonisolated private func parseMasOutdatedLine(_ line: String) -> MasOutdatedEntry? {
    // Find the numeric ID prefix
    let scanner = Scanner(string: line)
    guard let appId = scanner.scanCharacters(from: .decimalDigits),
      !appId.isEmpty
    else { return nil }

    // Find the version arrow within the last parenthesized group
    guard let lastOpenParen = line.lastIndex(of: "("),
      let lastCloseParen = line.lastIndex(of: ")"),
      lastCloseParen > lastOpenParen
    else { return nil }

    let versionPart = String(line[line.index(after: lastOpenParen)..<lastCloseParen])
    let arrowComponents = versionPart.components(separatedBy: "->")
    guard arrowComponents.count == 2 else { return nil }

    let newVersion = arrowComponents[1].trimmingCharacters(in: .whitespaces)
    guard !newVersion.isEmpty else { return nil }

    return MasOutdatedEntry(appId: appId, newVersion: newVersion)
  }

  // MARK: - Name matching

  /// Matches an InstalledApp to a MAS app ID by comparing names from `mas list`.
  nonisolated private func matchMasAppId(
    for app: InstalledApp,
    in listEntries: [MasListEntry]
  ) -> String? {
    let appName = app.name.trimmingCharacters(in: .whitespaces)

    // Exact case-insensitive match first
    let exactMatches = listEntries.filter {
      $0.appName.caseInsensitiveCompare(appName) == .orderedSame
    }
    if exactMatches.count == 1 {
      return exactMatches[0].appId
    }

    // Disambiguate by version if multiple exact name matches
    if exactMatches.count > 1, let installedVersion = app.version {
      if let versionMatch = exactMatches.first(where: { $0.version == installedVersion }) {
        return versionMatch.appId
      }
    }

    // Single exact match was found (handled above) or no match
    return exactMatches.count == 1 ? exactMatches[0].appId : nil
  }

  // MARK: - Process execution

  /// Runs a mas command with a timeout. Returns nil if the timeout fires.
  private func runWithTimeout(
    masPath: String,
    arguments: [String],
    timeoutSeconds: Int
  ) async -> CommandResult? {
    await withTaskGroup(of: CommandResult?.self) { group in
      group.addTask {
        try? await ProcessRunner.run(masPath, arguments: arguments)
      }
      group.addTask {
        try? await Task.sleep(for: .seconds(timeoutSeconds))
        return nil
      }

      let result = await group.next() ?? nil
      group.cancelAll()
      return result
    }
  }
}
