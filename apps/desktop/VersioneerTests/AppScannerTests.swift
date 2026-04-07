import Foundation
import Testing

@testable import Versioneer

struct BundleMetadataReaderTests {
  @Test func readsRealApplicationBundle() async {
    // /Applications/Safari.app should exist on all Macs
    let safariURL = URL(fileURLWithPath: "/Applications/Safari.app")
    let app = BundleMetadataReader.readApp(at: safariURL)

    // If Safari doesn't exist (CI), skip gracefully
    guard let app else { return }

    #expect(app.name == "Safari")
    #expect(app.bundleId == "com.apple.Safari")
    #expect(app.version != nil)
    #expect(app.path == "/Applications/Safari.app")
  }

  @Test func returnsNilForInvalidBundle() {
    let bogusURL = URL(fileURLWithPath: "/tmp/nonexistent.app")
    let app = BundleMetadataReader.readApp(at: bogusURL)
    #expect(app == nil)
  }

  @Test func scannerFindsApps() async {
    let scanner = AppScanner()
    let apps = await scanner.scan(roots: [URL(fileURLWithPath: "/Applications")])
    // Any Mac should have at least a few apps in /Applications
    #expect(apps.count > 0)
  }

  @Test func scannerFiltersServerDismissedBundleIds() async {
    let scanner = AppScanner()

    // First scan without dismissed list — Safari should be found
    let allApps = await scanner.scan(roots: [URL(fileURLWithPath: "/Applications")])
    // If Safari doesn't exist (CI), skip gracefully
    guard allApps.contains(where: { $0.bundleId == "com.apple.Safari" }) else { return }

    // Scan again with Safari in the dismissed list
    let filteredApps = await scanner.scan(
      roots: [URL(fileURLWithPath: "/Applications")],
      serverDismissedBundleIds: Set(["com.apple.Safari"])
    )
    #expect(!filteredApps.contains(where: { $0.bundleId == "com.apple.Safari" }))
  }
}
