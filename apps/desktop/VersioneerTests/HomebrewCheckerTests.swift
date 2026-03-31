import Testing

@testable import Versioneer

struct HomebrewCheckerTests {
  @Test func parsesVersionsFromBrewInfoJson() async {
    let checker = HomebrewChecker()
    let json = """
      {
        "casks": [
          {
            "token": "firefox",
            "version": "127.0"
          },
          {
            "token": "visual-studio-code",
            "versions": {
              "stable": "1.99.0"
            }
          }
        ]
      }
      """

    let versions = await checker.parseVersions(json: json)

    #expect(versions["firefox"] == "127.0")
    #expect(versions["visual-studio-code"] == "1.99.0")
  }
}
