import Foundation
import Testing

@testable import Versioneer

struct InstallCoordinatorRoutingTests {
  @MainActor
  @Test func nonAdminReplaceStaysLocal() {
    let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
    let plan = makePlan(strategy: .zipReplace)
    let destination = URL(fileURLWithPath: "/Applications/Local.app", isDirectory: true)

    #expect(
      coordinator.executionRoute(
        for: plan, destinationAppURL: destination, isDirectoryWritable: { _ in true }
      ) == .localReplace)
  }

  @MainActor
  @Test func adminReplaceUsesPrivilegedHelper() {
    let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
    let plan = makePlan(strategy: .dmgCopyReplace)
    let destination = URL(fileURLWithPath: "/Applications/Admin.app", isDirectory: true)

    #expect(
      coordinator.executionRoute(
        for: plan, destinationAppURL: destination, isDirectoryWritable: { _ in false }
      ) == .privilegedReplace
    )
  }

  @MainActor
  @Test func packageInstallAlwaysUsesPrivilegedHelper() {
    let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
    let plan = makePlan(strategy: .pkgInstall)

    #expect(coordinator.executionRoute(for: plan) == .privilegedPackage)
  }

  @MainActor
  @Test func sparkleBypassesPrivilegedHelper() {
    let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
    let plan = makePlan(strategy: .sparkle)

    #expect(coordinator.executionRoute(for: plan) == .sparkle)
  }

  @Test func catalogReportsRequirePreparedExecutionID() {
    let catalogPlan = makePlan(strategy: .zipReplace)
    let localPlan = InstallPlan(localId: "local_test", strategy: .zipReplace, origin: .local)

    #expect(
      InstallCoordinator.reportableExecutionID(
        for: catalogPlan,
        preparedExecutionId: "exec_prepared"
      ) == "exec_prepared"
    )
    #expect(
      InstallCoordinator.reportableExecutionID(
        for: catalogPlan,
        preparedExecutionId: nil
      ) == nil
    )
    #expect(
      InstallCoordinator.reportableExecutionID(
        for: localPlan,
        preparedExecutionId: "exec_prepared"
      ) == nil
    )
  }

  @Test func bundleArchitectureSupportsUniversalAndRosettaCompatibleSlices() {
    #expect(
      InstallCoordinator.bundleArchitectureSupportsTarget(
        bundleArchitecture: "universal",
        targetArchitecture: "arm64"
      )
    )
    #expect(
      InstallCoordinator.bundleArchitectureSupportsTarget(
        bundleArchitecture: "x86_64",
        targetArchitecture: "arm64"
      )
    )
  }

  @Test func bundleArchitectureRejectsKnownIncompatibleSlices() {
    #expect(
      !InstallCoordinator.bundleArchitectureSupportsTarget(
        bundleArchitecture: "arm64",
        targetArchitecture: "x86_64"
      )
    )
  }

  @MainActor
  @Test func stagingDirectoryRejectsTraversalExecutionID() throws {
    let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())

    do {
      _ = try coordinator.makeStagingDirectory(executionId: "../escape")
      Issue.record("Expected invalid execution ID to fail")
    } catch let error as InstallError {
      guard case .installerPayloadInvalid(let message) = error else {
        Issue.record("Unexpected install error: \(error.localizedDescription)")
        return
      }
      #expect(message.contains("execution ID"))
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @MainActor
  @Test func downloaderRejectsNonHTTPSCatalogArtifacts() async throws {
    let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
    let stagingDirectory = FileManager.default.temporaryDirectory.appendingPathComponent(
      "versioneer-insecure-download-\(UUID().uuidString)",
      isDirectory: true
    )
    try FileManager.default.createDirectory(
      at: stagingDirectory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: stagingDirectory) }

    let artifact = InventoryResult.Artifact(
      id: "artifact_http",
      downloadUrl: "http://example.com/app.dmg",
      architecture: nil,
      minOsVersion: nil,
      artifactType: "dmg",
      sizeBytes: nil,
      sha256: nil
    )

    do {
      _ = try await coordinator.downloadArtifact(
        artifact: artifact,
        strategy: .dmgCopyReplace,
        to: stagingDirectory
      )
      Issue.record("Expected non-HTTPS artifact download to fail")
    } catch let error as InstallError {
      guard case .downloadFailed(let message) = error else {
        Issue.record("Unexpected install error: \(error.localizedDescription)")
        return
      }
      #expect(message.contains("HTTPS"))
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  private func makePlan(
    strategy: InstallStrategy
  ) -> InstallPlan {
    InstallPlan(
      localId: "local_test",
      strategy: strategy,
      appId: "app_test",
      releaseId: "rel_test",
      artifact: nil
    )
  }

}

private struct NoopPrivilegedHelperClient: PrivilegedHelperClientProtocol {
  func performOperation(executionId _: String, stagingDirectory _: URL) async throws
    -> PrivilegedOperationResult
  {
    PrivilegedOperationResult(operationType: nil, succeeded: true, detail: "unused")
  }

  func registrationStatus() -> PrivilegedHelperRegistrationStatus {
    .enabled
  }
}
