import Foundation
import Testing

@testable import Versioneer

private let versionFormattingTestNow = Date(timeIntervalSince1970: 1_774_960_000)

struct VersionFormattingTests {
  @Test func statusLabelsAreReadable() {
    #expect(VersionFormatting.statusLabel(for: .upToDate) == "Up to Date")
    #expect(VersionFormatting.statusLabel(for: .updateAvailable) == "Update Available")
    #expect(VersionFormatting.statusLabel(for: .ambiguous) == "Ambiguous")
    #expect(VersionFormatting.statusLabel(for: .localOnly) == "Local Only")
    #expect(VersionFormatting.statusLabel(for: .incompatible) == "Not Compatible")
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
    #expect(
      VersionFormatting.relativeDate(from: nil, relativeTo: versionFormattingTestNow) == "—")
  }

  @Test func relativeDateParsesISO8601() {
    // A date far in the past should produce a relative string, not the raw ISO string
    let result = VersionFormatting.relativeDate(
      from: "2020-01-01T00:00:00Z",
      relativeTo: versionFormattingTestNow
    )
    #expect(result != "2020-01-01T00:00:00Z")
    #expect(!result.isEmpty)
  }

  @Test func parseDateRejectsVersionLikeStrings() {
    #expect(VersionFormatting.parseDate("12.7.4") == nil)
    #expect(VersionFormatting.parseDate("6.6.0") == nil)
  }

  @Test func parseDateRejectsImpossibleRFC2822CalendarDates() {
    #expect(VersionFormatting.parseDate("Wed, 31 Feb 2026 06:36:00 +0000") == nil)
  }

  @Test func resultsBrowserDateParserHandlesRFC2822() {
    let date = ResultsBrowserDateParser.date(from: "Wed, 11 Feb 2026 06:36:00 +0000")
    #expect(date?.timeIntervalSince1970 == 1_770_791_760)
  }

  @Test func resultsBrowserDateParserHandlesRFC2822GMT() {
    let date = ResultsBrowserDateParser.date(from: "11 Feb 2026 06:36:00 GMT")
    #expect(date?.timeIntervalSince1970 == 1_770_791_760)
  }
}
