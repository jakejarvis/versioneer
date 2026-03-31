import Testing

@testable import Versioneer

struct InstalledAppIdentityTests {
  @Test func duplicateBundleIDsKeepDistinctLocalIDs() {
    let first = InstalledApp(
      name: "Example",
      bundleId: "com.example.app",
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Applications/Example.app",
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
    let second = InstalledApp(
      name: "Example",
      bundleId: "com.example.app",
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Users/test/Applications/Example.app",
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

    #expect(first.bundleId == second.bundleId)
    #expect(first.localID != second.localID)
    #expect(first.id != second.id)
  }
}
