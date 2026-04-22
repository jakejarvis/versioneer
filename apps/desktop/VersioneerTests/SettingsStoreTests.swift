import Foundation
import Testing

@testable import Versioneer

@MainActor
struct SettingsStoreTests {
  @Test func bundleIdRulesNormalizeAndDeduplicate() throws {
    let (settings, suiteName) = try makeSettings()
    defer { UserDefaults.standard.removePersistentDomain(forName: suiteName) }

    let firstRule = try #require(
      IgnoredAppRule.make(
        displayName: "Arc",
        matchType: .bundleId,
        rawValue: " COMPANY.TheBrowser.Browser "
      ))
    let duplicateRule = try #require(
      IgnoredAppRule.make(
        displayName: "Arc Browser",
        matchType: .bundleId,
        rawValue: "company.thebrowser.browser"
      ))

    settings.addIgnoredAppRule(firstRule)
    settings.addIgnoredAppRule(duplicateRule)

    #expect(settings.ignoredAppRules.count == 1)
    #expect(settings.ignoredAppRules[0].matchValue == "company.thebrowser.browser")
  }

  @Test func pathRulesNormalizeAndPersist() throws {
    let (settings, suiteName) = try makeSettings()
    defer { UserDefaults.standard.removePersistentDomain(forName: suiteName) }

    let rule = try #require(
      IgnoredAppRule.make(
        displayName: "Test App",
        matchType: .path,
        rawValue: "/Applications/../Applications/Test App.app"
      ))

    settings.addIgnoredAppRule(rule)

    let reloadedDefaults = try #require(UserDefaults(suiteName: suiteName))
    let reloaded = SettingsStore(defaults: reloadedDefaults)
    let persistedRule = try #require(reloaded.ignoredAppRules.first)

    #expect(persistedRule.matchValue == "/Applications/Test App.app")
    #expect(persistedRule.displayName == "Test App")
  }

  @Test func ignoresMatchBundleIdAndFallbackPathRules() throws {
    let (settings, suiteName) = try makeSettings()
    defer { UserDefaults.standard.removePersistentDomain(forName: suiteName) }

    let firefox = DesktopUITestFixtures.makeInstalledApp(
      from: DesktopUITestFixtures.makeDecision(
        appName: "Firefox",
        bundleId: "org.mozilla.firefox",
        decision: .updateAvailable
      ))
    let pathOnlyApp = InstalledApp(
      name: "Path Only",
      bundleId: nil,
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Applications/Path Only.app",
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

    settings.addIgnoredAppRule(IgnoredAppRule.make(from: firefox))
    settings.addIgnoredAppRule(IgnoredAppRule.make(from: pathOnlyApp))

    #expect(settings.isIgnored(firefox))
    #expect(settings.isIgnored(pathOnlyApp))
  }

  @Test func masCliPathOverridePersistsAndClears() throws {
    let (settings, suiteName) = try makeSettings()
    defer { UserDefaults.standard.removePersistentDomain(forName: suiteName) }

    #expect(settings.masCliPathOverride == nil)

    settings.masCliPathOverride = "/usr/local/bin/mas"
    #expect(settings.masCliPathOverride == "/usr/local/bin/mas")

    settings.masCliPathOverride = nil
    #expect(settings.masCliPathOverride == nil)

    // Setting empty string also clears
    settings.masCliPathOverride = "/some/path"
    settings.masCliPathOverride = ""
    #expect(settings.masCliPathOverride == nil)
  }

  @Test func analyticsAndCrashReportingTogglesPersistIndependently() throws {
    let (settings, suiteName) = try makeSettings()
    defer { UserDefaults.standard.removePersistentDomain(forName: suiteName) }

    #expect(settings.analyticsEnabled)
    #expect(settings.crashReportingEnabled)

    settings.analyticsEnabled = false
    settings.crashReportingEnabled = true

    let reloadedDefaults = try #require(UserDefaults(suiteName: suiteName))
    #expect(reloadedDefaults.bool(forKey: "versioneer_analytics_enabled") == false)
    #expect(reloadedDefaults.bool(forKey: "versioneer_crashlytics_enabled") == true)

    let reloaded = SettingsStore(defaults: reloadedDefaults)

    #expect(!reloaded.analyticsEnabled)
    #expect(reloaded.crashReportingEnabled)

    reloaded.crashReportingEnabled = false
    reloaded.analyticsEnabled = true

    let secondReload = SettingsStore(defaults: reloadedDefaults)
    #expect(secondReload.analyticsEnabled)
    #expect(!secondReload.crashReportingEnabled)
  }

  @Test func defaultScanRootsIncludeSharedApplicationsAndExtras() throws {
    let (settings, suiteName) = try makeSettings()
    defer { UserDefaults.standard.removePersistentDomain(forName: suiteName) }

    settings.addExtraScanRoot("/Volumes/Tools/Apps")
    settings.addExtraScanRoot("/Volumes/Tools/Apps")

    let roots = settings.allScanRootURLs.map(\.path)

    #expect(roots.contains("/Applications"))
    #expect(roots.contains("/Users/Shared/Applications"))
    #expect(roots.contains("/Volumes/Tools/Apps"))
    #expect(roots.filter { $0 == "/Volumes/Tools/Apps" }.count == 1)
  }

  @Test func serverDismissedBundleIdsPersistAndClear() throws {
    let (settings, suiteName) = try makeSettings()
    defer { UserDefaults.standard.removePersistentDomain(forName: suiteName) }

    #expect(settings.serverDismissedBundleIds.isEmpty)

    settings.serverDismissedBundleIds = Set(["com.example.foo", "com.example.bar"])
    #expect(settings.serverDismissedBundleIds == Set(["com.example.foo", "com.example.bar"]))

    // Verify persistence through a fresh SettingsStore
    let reloadedDefaults = try #require(UserDefaults(suiteName: suiteName))
    let reloaded = SettingsStore(defaults: reloadedDefaults)
    #expect(reloaded.serverDismissedBundleIds == Set(["com.example.foo", "com.example.bar"]))

    // Clear
    settings.serverDismissedBundleIds = []
    #expect(settings.serverDismissedBundleIds.isEmpty)
  }

  private func makeSettings() throws -> (SettingsStore, String) {
    let suiteName = "com.jakejarvis.versioneer.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defaults.removePersistentDomain(forName: suiteName)
    return (SettingsStore(defaults: defaults), suiteName)
  }
}
