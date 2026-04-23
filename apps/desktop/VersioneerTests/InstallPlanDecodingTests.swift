import Foundation
import Testing

@testable import Versioneer

struct InstallPlanTests {
  @Test func createsInstallPlanFromInventoryResult() throws {
    let json = """
      {
        "app": {
          "name": "Firefox",
          "bundleId": "org.mozilla.firefox",
          "installedVersion": "126.0"
        },
        "decision": "update_available",
        "catalog": {
          "match": {
            "appId": "app_firefox",
            "appName": "Mozilla Firefox",
            "confidence": 98.0
          },
          "trackingState": "public",
          "localReasonCode": null,
          "iconUrl": null,
          "staleSince": null
        },
        "release": {
          "version": "127.0",
          "versionRaw": "127.0",
          "releaseId": "rel_456",
          "targetArchitecture": "arm64",
          "releasedAt": "2026-03-20T12:00:00Z",
          "artifact": {
            "id": "art_789",
            "downloadUrl": "https://example.com/firefox.zip",
            "architecture": "universal",
            "minOsVersion": "13.0",
            "artifactType": "zip",
            "sizeBytes": 123456,
            "sha256": "abc123"
          }
        },
        "install": {
          "strategy": "zip_replace",
          "trust": {
            "status": "one_click",
            "resolvedStrategy": "zip_replace",
            "reasons": []
          },
          "homebrewCaskToken": null
        },
        "channels": { "selected": "stable", "available": ["stable"] }
      }
      """

    let decision = try JSONDecoder().decode(InventoryResult.self, from: Data(json.utf8))
    let plan = try #require(InstallPlan(result: decision, installedApp: nil))

    #expect(plan.strategy == .zipReplace)
    #expect(plan.isCatalogBacked)
    #expect(plan.appId == "app_firefox")
    #expect(plan.releaseId == "rel_456")
    #expect(plan.targetArchitecture == "arm64")
    #expect(plan.artifact?.id == "art_789")
    #expect(plan.artifact?.sha256 == "abc123")
    #expect(!plan.localId.isEmpty)
  }

  @Test func returnsNilWhenCatalogTrustMaterialIsMissing() throws {
    let json = """
      {
        "app": {
          "name": "Firefox",
          "bundleId": "org.mozilla.firefox",
          "installedVersion": "126.0"
        },
        "decision": "update_available",
        "catalog": {
          "match": {
            "appId": "app_firefox",
            "appName": "Mozilla Firefox",
            "confidence": 98.0
          },
          "trackingState": "public",
          "localReasonCode": null,
          "iconUrl": null,
          "staleSince": null
        },
        "release": {
          "version": "127.0",
          "versionRaw": "127.0",
          "releaseId": "rel_456",
          "targetArchitecture": null,
          "releasedAt": "2026-03-20T12:00:00Z",
          "artifact": {
            "id": "art_789",
            "downloadUrl": "https://example.com/firefox.zip",
            "architecture": "universal",
            "minOsVersion": "13.0",
            "artifactType": "zip",
            "sizeBytes": 123456,
            "sha256": null
          }
        },
        "install": {
          "strategy": null,
          "trust": {
            "status": "manual_only",
            "resolvedStrategy": "zip_replace",
            "reasons": ["missing_sha256", "missing_team_id"]
          },
          "homebrewCaskToken": null
        },
        "channels": { "selected": "stable", "available": ["stable"] }
      }
      """

    let decision = try JSONDecoder().decode(InventoryResult.self, from: Data(json.utf8))
    let plan = InstallPlan(result: decision, installedApp: nil)

    #expect(decision.installTrust.status == .manualOnly)
    #expect(plan == nil)
  }

  @Test func createsInstallPlanWhenCatalogTrustIsDegradedButNotBlocked() throws {
    let json = """
      {
        "app": {
          "name": "Firefox",
          "bundleId": "org.mozilla.firefox",
          "installedVersion": "126.0"
        },
        "decision": "update_available",
        "catalog": {
          "match": {
            "appId": "app_firefox",
            "appName": "Mozilla Firefox",
            "confidence": 98.0
          },
          "trackingState": "public",
          "localReasonCode": null,
          "iconUrl": null,
          "staleSince": null
        },
        "release": {
          "version": "127.0",
          "versionRaw": "127.0",
          "releaseId": "rel_456",
          "targetArchitecture": "arm64",
          "releasedAt": "2026-03-20T12:00:00Z",
          "artifact": {
            "id": "art_789",
            "downloadUrl": "https://example.com/firefox.zip",
            "architecture": "unknown",
            "minOsVersion": "13.0",
            "artifactType": "zip",
            "sizeBytes": 123456,
            "sha256": null
          }
        },
        "install": {
          "strategy": "zip_replace",
          "trust": {
            "status": "one_click",
            "resolvedStrategy": "zip_replace",
            "reasons": ["missing_sha256", "unknown_architecture"]
          },
          "homebrewCaskToken": null
        },
        "channels": { "selected": "stable", "available": ["stable", "beta"] }
      }
      """

    let decision = try JSONDecoder().decode(InventoryResult.self, from: Data(json.utf8))
    let plan = try #require(InstallPlan(result: decision, installedApp: nil))

    #expect(decision.installTrust.status == .oneClick)
    #expect(decision.installTrust.reasons == [.missingSHA256, .unknownArchitecture])
    #expect(plan.strategy == .zipReplace)
  }

  @Test func returnsNilForUninstallableDecision() throws {
    let json = """
      {
        "app": {
          "name": "Firefox",
          "bundleId": "org.mozilla.firefox",
          "installedVersion": "127.0"
        },
        "decision": "up_to_date",
        "catalog": {
          "match": {
            "appId": "app_firefox",
            "appName": "Mozilla Firefox",
            "confidence": 98.0
          },
          "trackingState": "public",
          "localReasonCode": null,
          "iconUrl": null,
          "staleSince": null
        },
        "release": {
          "version": "127.0",
          "versionRaw": "127.0",
          "releaseId": "rel_456",
          "targetArchitecture": null,
          "releasedAt": "2026-03-20T12:00:00Z",
          "artifact": null
        },
        "install": {
          "strategy": null,
          "trust": {
            "status": "none",
            "resolvedStrategy": null,
            "reasons": []
          },
          "homebrewCaskToken": null
        },
        "channels": { "selected": "stable", "available": ["stable"] }
      }
      """

    let decision = try JSONDecoder().decode(InventoryResult.self, from: Data(json.utf8))
    let plan = InstallPlan(result: decision, installedApp: nil)

    #expect(plan == nil)
  }

  @Test func createsLocalSparklePlanWithoutCatalogIdentifiers() throws {
    let decision = InventoryResult(
      appName: "Mystery",
      bundleId: "com.example.mystery",
      installedVersion: "1.0",
      matchedAppId: nil,
      matchedAppName: nil,
      matchConfidence: nil,
      decision: .updateAvailable,
      trackingState: .localOnly,
      localReasonCode: .notFound,
      latestVersion: "1.1",
      latestVersionRaw: "1.1",
      latestReleaseId: nil,
      channel: nil,
      availableChannels: nil,
      homebrewCaskToken: nil,
      releasedAt: nil,
      staleSince: nil,
      iconUrl: nil,
      artifact: nil,
      installStrategy: .sparkle,
      localAppID: "/Applications/Mystery.app"
    )
    let installedApp = InstalledApp(
      name: "Mystery",
      bundleId: "com.example.mystery",
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Applications/Mystery.app",
      architecture: nil,
      sparkleFeedUrl: "https://example.com/appcast.xml",
      sparklePublicKey: nil,
      isSparkleApp: true,
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

    let plan = try #require(InstallPlan(result: decision, installedApp: installedApp))

    #expect(!plan.isCatalogBacked)
    #expect(plan.strategy == .sparkle)
    #expect(plan.appId == nil)
    #expect(plan.releaseId == nil)
  }

  @Test func localDirectInstallRequiresIdentityAnchor() {
    let decision = InventoryResult(
      appName: "Mystery",
      bundleId: nil,
      installedVersion: "1.0",
      matchedAppId: nil,
      matchedAppName: nil,
      matchConfidence: nil,
      decision: .updateAvailable,
      trackingState: .localOnly,
      localReasonCode: .notFound,
      latestVersion: "1.1",
      latestVersionRaw: "1.1",
      latestReleaseId: nil,
      channel: nil,
      availableChannels: nil,
      homebrewCaskToken: nil,
      releasedAt: nil,
      staleSince: nil,
      iconUrl: nil,
      artifact: .init(
        id: nil,
        downloadUrl: "https://example.com/mystery.zip",
        architecture: nil,
        minOsVersion: nil,
        artifactType: "zip",
        sizeBytes: nil,
        sha256: nil
      ),
      installStrategy: .zipReplace,
      localAppID: "/Applications/Mystery.app"
    )

    let unverifiedInstalledApp = InstalledApp(
      name: "Mystery",
      bundleId: nil,
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Applications/Mystery.app",
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

    #expect(InstallPlan(result: decision, installedApp: unverifiedInstalledApp) == nil)

    let verifiedInstalledApp = InstalledApp(
      name: "Mystery",
      bundleId: "com.example.mystery",
      version: "1.0",
      buildNumber: nil,
      teamId: nil,
      path: "/Applications/Mystery.app",
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

    let plan = InstallPlan(result: decision, installedApp: verifiedInstalledApp)
    #expect(plan?.isCatalogBacked == false)
    #expect(plan?.strategy == .zipReplace)
  }
}
