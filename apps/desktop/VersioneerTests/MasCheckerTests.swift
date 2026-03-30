import Foundation
import Testing

@testable import Versioneer

struct MasCheckerTests {
  private let checker = MasChecker()

  // MARK: - mas list parsing

  @Test func parsesStandardMasListOutput() async {
    let output = """
      497799835 Xcode (15.4)
      883878097 Server (5.7.1)
      409183694 Keynote (10.3.5)
      """

    let entries = await checker.parseMasList(output)
    #expect(entries.count == 3)

    #expect(entries[0].appId == "497799835")
    #expect(entries[0].appName == "Xcode")
    #expect(entries[0].version == "15.4")

    #expect(entries[1].appId == "883878097")
    #expect(entries[1].appName == "Server")
    #expect(entries[1].version == "5.7.1")

    #expect(entries[2].appId == "409183694")
    #expect(entries[2].appName == "Keynote")
    #expect(entries[2].version == "10.3.5")
  }

  @Test func parsesAppNamesWithParentheses() async {
    let output = "441258766 Magnet (Pro) (2.14.0)\n"
    let entries = await checker.parseMasList(output)
    #expect(entries.count == 1)
    #expect(entries[0].appId == "441258766")
    #expect(entries[0].appName == "Magnet (Pro)")
    #expect(entries[0].version == "2.14.0")
  }

  @Test func parsesAppNamesWithUnicode() async {
    let output = "123456789 Über App (1.0)\n"
    let entries = await checker.parseMasList(output)
    #expect(entries.count == 1)
    #expect(entries[0].appName == "Über App")
  }

  @Test func skipsMalformedMasListLines() async {
    let output = """
      497799835 Xcode (15.4)
      not a valid line

      883878097 Server (5.7.1)
      """
    let entries = await checker.parseMasList(output)
    #expect(entries.count == 2)
  }

  @Test func parsesEmptyMasListOutput() async {
    let entries = await checker.parseMasList("")
    #expect(entries.isEmpty)
  }

  // MARK: - mas outdated parsing

  @Test func parsesStandardMasOutdatedOutput() async {
    let output = """
      497799835 Xcode (15.4 -> 16.0)
      883878097 Server (5.7.1 -> 5.8.0)
      """

    let entries = await checker.parseMasOutdated(output)
    #expect(entries.count == 2)

    #expect(entries[0].appId == "497799835")
    #expect(entries[0].newVersion == "16.0")

    #expect(entries[1].appId == "883878097")
    #expect(entries[1].newVersion == "5.8.0")
  }

  @Test func parsesEmptyMasOutdatedOutput() async {
    let entries = await checker.parseMasOutdated("")
    #expect(entries.isEmpty)
  }

  @Test func skipsMalformedMasOutdatedLines() async {
    let output = """
      497799835 Xcode (15.4 -> 16.0)
      not a valid line
      no arrow here (1.0)
      883878097 Server (5.7.1 -> 5.8.0)
      """
    let entries = await checker.parseMasOutdated(output)
    #expect(entries.count == 2)
  }

  // MARK: - checkAll integration (without running mas)

  @Test func returnsEmptyWhenMasPathIsNil() async {
    let apps = [makeMasInstalledApp(name: "Xcode", bundleId: "com.apple.dt.Xcode")]
    let results = await checker.checkAll(apps: apps, masCliPath: nil)
    #expect(results.isEmpty)
  }

  @Test func returnsEmptyWhenNoMasApps() async {
    let apps = [makeNonMasInstalledApp(name: "Firefox", bundleId: "org.mozilla.firefox")]
    let results = await checker.checkAll(apps: apps, masCliPath: "/nonexistent/mas")
    #expect(results.isEmpty)
  }

  // MARK: - Helpers

  private func makeMasInstalledApp(name: String, bundleId: String) -> InstalledApp {
    InstalledApp(
      name: name,
      bundleId: bundleId,
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Applications/\(name).app",
      architecture: nil,
      sparkleFeedUrl: nil,
      sparklePublicKey: nil,
      isSparkleApp: false,
      isMasApp: true,
      masAppId: nil,
      isElectronApp: false,
      electronUpdateProvider: nil,
      electronUpdateUrl: nil,
      codeSigningAuthority: nil,
      appCategory: nil,
      minMacOSVersion: nil,
      isHomebrewInstalled: false,
      homebrewCaskToken: nil
    )
  }

  private func makeNonMasInstalledApp(name: String, bundleId: String) -> InstalledApp {
    InstalledApp(
      name: name,
      bundleId: bundleId,
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Applications/\(name).app",
      architecture: nil,
      sparkleFeedUrl: nil,
      sparklePublicKey: nil,
      isSparkleApp: false,
      isMasApp: false,
      masAppId: nil,
      isElectronApp: false,
      electronUpdateProvider: nil,
      electronUpdateUrl: nil,
      codeSigningAuthority: nil,
      appCategory: nil,
      minMacOSVersion: nil,
      isHomebrewInstalled: false,
      homebrewCaskToken: nil
    )
  }
}
