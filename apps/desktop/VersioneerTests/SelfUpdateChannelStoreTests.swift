import Foundation
import Testing

@testable import Versioneer

@MainActor
struct SelfUpdateChannelStoreTests {
  @Test func stableUsesDefaultSparkleChannelOnly() {
    #expect(SelfUpdateChannel.stable.allowedSparkleChannels.isEmpty)
  }

  @Test func nightlyIncludesNightlySparkleChannel() {
    #expect(SelfUpdateChannel.nightly.allowedSparkleChannels == Set(["nightly"]))
  }

  @Test func firstLaunchDefaultsFromBundleReleaseTrack() throws {
    let (defaults, suiteName) = try makeDefaults()
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let bundle = Bundle(for: BundleToken.self).bundleURL
      .appendingPathComponent("SelfUpdateNightly.bundle")
    try createBundle(
      at: bundle,
      infoDictionary: [SelfUpdateChannel.bundleInfoKey: SelfUpdateChannel.nightly.rawValue]
    )

    var store = SelfUpdateChannelStore(
      defaults: defaults,
      bundle: try #require(Bundle(url: bundle))
    )

    #expect(store.channel == .nightly)
    #expect(defaults.string(forKey: SelfUpdateChannelStore.defaultsKey) == "nightly")
  }

  @Test func existingStoredChoiceWinsOverBundleDefault() throws {
    let (defaults, suiteName) = try makeDefaults()
    defer { defaults.removePersistentDomain(forName: suiteName) }

    defaults.set(SelfUpdateChannel.stable.rawValue, forKey: SelfUpdateChannelStore.defaultsKey)

    let bundle = Bundle(for: BundleToken.self).bundleURL
      .appendingPathComponent("SelfUpdateNightlyStored.bundle")
    try createBundle(
      at: bundle,
      infoDictionary: [SelfUpdateChannel.bundleInfoKey: SelfUpdateChannel.nightly.rawValue]
    )

    var store = SelfUpdateChannelStore(
      defaults: defaults,
      bundle: try #require(Bundle(url: bundle))
    )

    #expect(store.channel == .stable)
    #expect(defaults.string(forKey: SelfUpdateChannelStore.defaultsKey) == "stable")
  }

  @Test func selfUpdateChannelDoesNotTouchCatalogChannelSettings() throws {
    let (defaults, suiteName) = try makeDefaults()
    defer { defaults.removePersistentDomain(forName: suiteName) }

    let settings = SettingsStore(defaults: defaults)
    settings.defaultChannel = "nightly"
    settings.setChannel("beta", forAppId: "com.example.app")

    var store = SelfUpdateChannelStore(defaults: defaults, bundle: .main)
    store.channel = .stable

    #expect(settings.defaultChannel == "nightly")
    #expect(settings.channel(forAppId: "com.example.app") == "beta")
    #expect(defaults.string(forKey: SelfUpdateChannelStore.defaultsKey) == "stable")
  }

  private func makeDefaults() throws -> (UserDefaults, String) {
    let suiteName = "com.jakejarvis.versioneer.self-update.tests.\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: suiteName))
    defaults.removePersistentDomain(forName: suiteName)
    return (defaults, suiteName)
  }

  private func createBundle(at bundleURL: URL, infoDictionary: [String: Any]) throws {
    let fileManager = FileManager.default
    let contentsURL = bundleURL.appendingPathComponent("Contents")

    try? fileManager.removeItem(at: bundleURL)
    try fileManager.createDirectory(at: contentsURL, withIntermediateDirectories: true)

    let plistURL = contentsURL.appendingPathComponent("Info.plist")
    let data = try PropertyListSerialization.data(
      fromPropertyList: infoDictionary,
      format: .xml,
      options: 0
    )
    try data.write(to: plistURL)
  }
}

private final class BundleToken {}
