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
        let apps = await scanner.scan()
        // Any Mac should have at least a few apps in /Applications
        #expect(apps.count > 0)
    }
}
