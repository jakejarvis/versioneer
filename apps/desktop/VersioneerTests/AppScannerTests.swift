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

  @Test func rejectsNonWebUpdateFeedURLsFromBundleMetadata() throws {
    let appURL = try makeTemporaryAppBundle(
      info: [
        "CFBundleName": "Unsafe Feed",
        "CFBundleIdentifier": "com.example.unsafe-feed",
        "CFBundlePackageType": "APPL",
        "SUFeedURL": "file://localhost/etc/passwd",
      ])
    defer { try? FileManager.default.removeItem(at: appURL.deletingLastPathComponent()) }

    let app = BundleMetadataReader.readApp(at: appURL)

    #expect(app?.sparkleFeedUrl == nil)
  }

  @Test func acceptsHTTPSUpdateFeedURLsFromBundleMetadata() throws {
    let appURL = try makeTemporaryAppBundle(
      info: [
        "CFBundleName": "Safe Feed",
        "CFBundleIdentifier": "com.example.safe-feed",
        "CFBundlePackageType": "APPL",
        "SUFeedURL": "https://updates.example.com/appcast.xml",
      ])
    defer { try? FileManager.default.removeItem(at: appURL.deletingLastPathComponent()) }

    let app = BundleMetadataReader.readApp(at: appURL)

    #expect(app?.sparkleFeedUrl == "https://updates.example.com/appcast.xml")
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

  private func makeTemporaryAppBundle(info: [String: Any]) throws -> URL {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    let appURL = root.appendingPathComponent("Fixture.app", isDirectory: true)
    let contentsURL = appURL.appendingPathComponent("Contents", isDirectory: true)
    try FileManager.default.createDirectory(at: contentsURL, withIntermediateDirectories: true)
    let data = try PropertyListSerialization.data(
      fromPropertyList: info,
      format: .xml,
      options: 0
    )
    try data.write(to: contentsURL.appendingPathComponent("Info.plist"))
    return appURL
  }
}
