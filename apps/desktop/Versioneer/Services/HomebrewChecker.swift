import Foundation
import Logging

/// Checks Homebrew Cask installs for locally detectable updates.
actor HomebrewChecker {
  struct HomebrewResult: Sendable {
    let caskToken: String
    let latestVersion: String?
    let updateDetected: Bool
  }

  private let fileManager: FileManager

  init(fileManager: FileManager = .default) {
    self.fileManager = fileManager
  }

  func checkAll(apps: [InstalledApp]) async -> [String: HomebrewResult] {
    let caskApps = apps.filter { app in
      guard app.isHomebrewInstalled else { return false }
      guard let token = app.homebrewCaskToken else { return false }
      return !token.isEmpty
    }
    guard !caskApps.isEmpty else { return [:] }

    guard let brewPath = brewExecutablePath() else {
      Logger.homebrew.debug("Skipping Homebrew checks because brew was not found")
      return [:]
    }

    Logger.homebrew.info("Checking \(caskApps.count) Homebrew casks locally")

    let tokens = Array(Set(caskApps.compactMap(\.homebrewCaskToken))).sorted()
    let outdatedTokens = await outdatedCaskTokens(
      tokens: tokens,
      brewPath: brewPath
    )
    guard !outdatedTokens.isEmpty else { return [:] }

    let versionsByToken = await latestVersionsByToken(
      tokens: outdatedTokens,
      brewPath: brewPath
    )

    var results: [String: HomebrewResult] = [:]
    for app in caskApps {
      guard let token = app.homebrewCaskToken, outdatedTokens.contains(token) else { continue }
      results[app.localID] = HomebrewResult(
        caskToken: token,
        latestVersion: versionsByToken[token],
        updateDetected: true
      )
    }

    Logger.homebrew.info(
      "Homebrew checks complete: \(results.count)/\(caskApps.count) outdated")
    return results
  }

  private func brewExecutablePath() -> String? {
    let candidates = ["/opt/homebrew/bin/brew", "/usr/local/bin/brew"]
    return candidates.first { fileManager.isExecutableFile(atPath: $0) }
  }

  private func outdatedCaskTokens(
    tokens: [String],
    brewPath: String
  ) async -> Set<String> {
    var outdated = Set<String>()
    var batchStart = 0
    while batchStart < tokens.count {
      let batchEnd = min(batchStart + 50, tokens.count)
      let batch = Array(tokens[batchStart..<batchEnd])
      do {
        let result = try await ProcessRunner.runSuccessful(
          brewPath,
          arguments: ["outdated", "--quiet", "--cask"] + batch
        )
        let batchTokens = result.stdout
          .split(whereSeparator: \.isNewline)
          .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
          .filter { !$0.isEmpty }
        outdated.formUnion(batchTokens)
      } catch {
        Logger.homebrew.debug(
          "Homebrew outdated check failed for \(batch.count) casks: \(error.localizedDescription)"
        )
      }

      batchStart = batchEnd
    }

    return outdated
  }

  private func latestVersionsByToken(
    tokens: Set<String>,
    brewPath: String
  ) async -> [String: String] {
    guard !tokens.isEmpty else { return [:] }

    var versions: [String: String] = [:]
    let sortedTokens = Array(tokens).sorted()
    var batchStart = 0
    while batchStart < sortedTokens.count {
      let batchEnd = min(batchStart + 25, sortedTokens.count)
      let batch = Array(sortedTokens[batchStart..<batchEnd])
      do {
        let result = try await ProcessRunner.runSuccessful(
          brewPath,
          arguments: ["info", "--json=v2", "--cask"] + batch
        )
        let batchVersions = parseVersions(json: result.stdout)
        for (token, version) in batchVersions {
          versions[token] = version
        }
      } catch {
        Logger.homebrew.debug(
          "Homebrew info lookup failed for \(batch.count) casks: \(error.localizedDescription)"
        )
      }

      batchStart = batchEnd
    }

    return versions
  }

  func parseVersions(json: String) -> [String: String] {
    guard let data = json.data(using: .utf8),
      let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
      let casks = root["casks"] as? [[String: Any]]
    else {
      return [:]
    }

    var versions: [String: String] = [:]
    for cask in casks {
      guard let token = cask["token"] as? String else { continue }

      let version =
        (cask["version"] as? String)
        ?? ((cask["versions"] as? [String: Any])?["stable"] as? String)
        ?? ((cask["versions"] as? [String: Any])?["latest"] as? String)

      if let version, !version.isEmpty {
        versions[token] = version
      }
    }

    return versions
  }
}
