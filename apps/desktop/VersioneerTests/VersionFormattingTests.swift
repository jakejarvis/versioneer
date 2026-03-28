import Testing

@testable import Versioneer

struct VersionFormattingTests {
  @Test func statusLabelsAreReadable() {
    #expect(VersionFormatting.statusLabel(for: .upToDate) == "Up to Date")
    #expect(VersionFormatting.statusLabel(for: .updateAvailable) == "Update Available")
    #expect(VersionFormatting.statusLabel(for: .ambiguous) == "Ambiguous")
    #expect(VersionFormatting.statusLabel(for: .notTracked) == "Not Tracked")
  }

  @Test func displayVersionShowsDash() {
    #expect(VersionFormatting.displayVersion(nil) == "—")
    #expect(VersionFormatting.displayVersion("1.2.3") == "1.2.3")
  }

  @Test func confidenceLabelFormatting() {
    #expect(VersionFormatting.confidenceLabel(nil) == "—")
    #expect(VersionFormatting.confidenceLabel(87.5) == "87%")
    #expect(VersionFormatting.confidenceLabel(100) == "100%")
    #expect(VersionFormatting.confidenceLabel(0) == "0%")
  }

  @Test func relativeDateHandlesNil() {
    #expect(VersionFormatting.relativeDate(from: nil) == "—")
  }

  @Test func relativeDateParsesISO8601() {
    // A date far in the past should produce a relative string, not the raw ISO string
    let result = VersionFormatting.relativeDate(from: "2020-01-01T00:00:00Z")
    #expect(result != "2020-01-01T00:00:00Z")
    #expect(!result.isEmpty)
  }
}
