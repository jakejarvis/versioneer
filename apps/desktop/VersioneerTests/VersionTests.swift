import Foundation
import Testing

@testable import Versioneer

struct VersionTests {

  // MARK: - Parsing

  @Test func parsesSimpleSemver() {
    let v = Version("1.2.3")
    #expect(v.valid)
    #expect(v.major == 1)
    #expect(v.minor == 2)
    #expect(v.patch == 3)
    #expect(v.preReleaseTag == nil)
  }

  @Test func parsesTwoSegmentVersion() {
    let v = Version("1.2")
    #expect(v.valid)
    #expect(v.major == 1)
    #expect(v.minor == 2)
    #expect(v.patch == 0)
  }

  @Test func parsesDateLikeVersion() {
    let v = Version("2024.9")
    #expect(v.valid)
    #expect(v.major == 2024)
    #expect(v.minor == 9)
  }

  @Test func parsesVersionWithLeadingV() {
    let v = Version("v3.1.4")
    #expect(v.valid)
    #expect(v.major == 3)
    #expect(v.minor == 1)
    #expect(v.patch == 4)
  }

  @Test func parsesInlinePreRelease() {
    let v = Version("5.0b3")
    #expect(v.valid)
    #expect(v.major == 5)
    #expect(v.minor == 0)
    #expect(v.preReleaseTag == "b")
    #expect(v.preReleaseNumber == 3)
  }

  @Test func parsesDashPreRelease() {
    let v = Version("1.0-rc1")
    #expect(v.valid)
    #expect(v.major == 1)
    #expect(v.minor == 0)
    #expect(v.preReleaseTag == "rc")
    #expect(v.preReleaseNumber == 1)
  }

  @Test func parsesVersionWithBuildMetadata() {
    let v = Version("1.0.0+build123")
    #expect(v.valid)
    #expect(v.major == 1)
    #expect(v.buildMetadata == "build123")
  }

  @Test func parsesFourSegmentVersion() {
    let v = Version("1.2.3.4")
    #expect(v.valid)
    #expect(v.extra == [4])
  }

  @Test func returnsInvalidForEmptyString() {
    let v = Version("")
    #expect(!v.valid)
  }

  @Test func parsesAlphaPreRelease() {
    let v = Version("2.0-alpha.1")
    #expect(v.valid)
    #expect(v.preReleaseTag == "alpha")
    #expect(v.preReleaseNumber == 1)
  }

  @Test func parsesSingleSegmentVersion() {
    let v = Version("5")
    #expect(v.valid)
    #expect(v.major == 5)
    #expect(v.minor == 0)
    #expect(v.patch == 0)
  }

  @Test func parsesZeroAsValidVersion() {
    let v = Version("0")
    #expect(v.valid)
    #expect(v.major == 0)
  }

  @Test func handlesTrailingDot() {
    let v = Version("1.2.3.")
    #expect(v.valid)
    #expect(v.major == 1)
    #expect(v.minor == 2)
    #expect(v.patch == 3)
    #expect(v.extra.isEmpty)
  }

  @Test func rejectsConsecutiveDots() {
    let v = Version("1..2")
    #expect(!v.valid)
  }

  @Test func clampsNegativeSegmentsToZero() {
    let v = Version("-1.0.0")
    #expect(v.valid)
    #expect(v.major == 0)
  }

  @Test func clampsSegmentsExceedingLimit() {
    let v = Version("99999999999.0.0")
    #expect(v.valid)
    #expect(v.major == 9_999_999_999)
  }

  @Test func stripsNamePrefix() {
    let v = Version("release-3.5.7-beta3")
    #expect(v.valid)
    #expect(v.major == 3)
    #expect(v.minor == 5)
    #expect(v.patch == 7)
    #expect(v.preReleaseTag == "beta")
    #expect(v.preReleaseNumber == 3)
  }

  @Test func stripsXQuartzStyleNamePrefix() {
    let v = Version("XQuartz-2.8.6_beta4")
    #expect(v.valid)
    #expect(v.major == 2)
    #expect(v.minor == 8)
    #expect(v.patch == 6)
    #expect(v.preReleaseTag == "beta")
    #expect(v.preReleaseNumber == 4)
  }

  @Test func doesNotStripPreReleaseTagPrefix() {
    // "beta" is a known pre-release tag, not a name prefix
    let v = Version("beta-1.0")
    #expect(v.major == 0)
  }

  // MARK: - Comparison

  @Test func basicOrdering() {
    #expect(Version("1.0.0") < Version("1.0.1"))
    #expect(Version("2.0.0") > Version("1.9.9"))
    #expect(Version("1.0.0") == Version("1.0.0"))
  }

  @Test func preReleaseIsOlderThanRelease() {
    #expect(Version("1.0.0-beta1") < Version("1.0.0"))
  }

  @Test func betaGreaterThanAlpha() {
    #expect(Version("1.0.0-beta1") > Version("1.0.0-alpha1"))
  }

  @Test func rcGreaterThanBeta() {
    #expect(Version("1.0.0-rc1") > Version("1.0.0-beta1"))
  }

  @Test func preReleaseTagOrdering() {
    let alpha = Version("1.0.0-alpha1")
    let beta = Version("1.0.0-beta1")
    let rc = Version("1.0.0-rc1")
    let release = Version("1.0.0")
    #expect(alpha < beta)
    #expect(beta < rc)
    #expect(rc < release)
  }

  @Test func devSortsBeforeAlpha() {
    #expect(Version("1.0.0-dev1") < Version("1.0.0-alpha1"))
  }

  @Test func trailingZerosEqual() {
    #expect(Version("1.2") == Version("1.2.0"))
  }

  @Test func sortVersionsCorrectly() {
    var versions = ["3.0", "1.0", "2.0", "1.0-beta1"].map(Version.init)
    versions.sort()
    #expect(versions.map(\.raw) == ["1.0-beta1", "1.0", "2.0", "3.0"])
  }

  @Test func isPreReleaseProperty() {
    #expect(Version("1.0.0-beta1").isPreRelease)
    #expect(Version("5.0b3").isPreRelease)
    #expect(!Version("1.0.0").isPreRelease)
  }

  @Test func isAtLeast() {
    #expect(Version("15.0.0").isAtLeast(Version("14.0.0")))
    #expect(Version("14.0.0").isAtLeast(Version("14.0.0")))
    #expect(!Version("13.9.9").isAtLeast(Version("14.0.0")))
  }

  @Test func buildMetadataIgnoredInComparison() {
    #expect(Version("1.0.0+build1") == Version("1.0.0+build2"))
    #expect(Version("1.0.0+build1") == Version("1.0.0"))
  }

  @Test func invalidVersionsSortBeforeValid() {
    #expect(Version("") < Version("0"))
  }

  @Test func twoInvalidVersionsAreEqual() {
    #expect(Version("") == Version("not-a-version"))
  }

  // MARK: - Sanitization

  @Test func sanitizesAppendedBuildNumber() {
    // Remote "1.2.40" where local is version "1.2" build "40"
    let remote = Version("1.2.40")
    let sanitized = remote.sanitized(localVersion: "1.2", localBuildNumber: "40")
    #expect(sanitized == Version("1.2"))
  }

  @Test func sanitizesThreeSegmentAppendedBuildNumber() {
    // Remote "5.3.2.1234" where local is version "5.3.2" build "1234"
    let remote = Version("5.3.2.1234")
    let sanitized = remote.sanitized(localVersion: "5.3.2", localBuildNumber: "1234")
    #expect(sanitized == Version("5.3.2"))
  }

  @Test func sanitizesAppendedBuildNumberWithTrailingZero() {
    // Remote "1.0.40" where local is version "1.0" build "40"
    // The ".0" in "1.0" must not be stripped — it's a meaningful segment
    let remote = Version("1.0.40")
    let sanitized = remote.sanitized(localVersion: "1.0", localBuildNumber: "40")
    #expect(sanitized == Version("1.0"))
  }

  @Test func doesNotSanitizeWhenBuildDoesNotMatch() {
    // Remote "1.2.3" where local is version "1.2" build "99" — no match
    let remote = Version("1.2.3")
    let sanitized = remote.sanitized(localVersion: "1.2", localBuildNumber: "99")
    #expect(sanitized == Version("1.2.3"))
  }

  @Test func doesNotSanitizeWhenSegmentCountsMatch() {
    // Remote "1.2.3" where local is version "1.2.3" build "40" — same segment count
    let remote = Version("1.2.3")
    let sanitized = remote.sanitized(localVersion: "1.2.3", localBuildNumber: "40")
    #expect(sanitized == Version("1.2.3"))
  }

  @Test func sanitizeHandlesNilBuildNumber() {
    let remote = Version("1.2.3")
    let sanitized = remote.sanitized(localVersion: "1.2", localBuildNumber: nil)
    #expect(sanitized == Version("1.2.3"))
  }

  @Test func sanitizeHandlesInvalidVersion() {
    let remote = Version("")
    let sanitized = remote.sanitized(localVersion: "1.0", localBuildNumber: "10")
    #expect(!sanitized.valid)
  }
}
