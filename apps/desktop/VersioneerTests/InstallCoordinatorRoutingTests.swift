import Foundation
import Testing

@testable import Versioneer

struct InstallCoordinatorRoutingTests {
  @MainActor
  @Test func nonAdminReplaceStaysLocal() throws {
    let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
    let prepared = makePrepared(strategy: .zipReplace)
    let destination = try makeWritableDestination(named: "Local.app")

    #expect(
      coordinator.executionRoute(for: prepared, destinationAppURL: destination) == .localReplace)
  }

  @MainActor
  @Test func adminReplaceUsesPrivilegedHelper() throws {
    let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
    // pkgInstall requires admin by default; for dmgCopyReplace, admin is determined by
    // file system writability. Use an unwritable destination to trigger privileged path.
    let prepared = makePrepared(strategy: .dmgCopyReplace)
    let destination = URL(fileURLWithPath: "/Applications/Admin.app")

    #expect(
      coordinator.executionRoute(for: prepared, destinationAppURL: destination) == .privilegedReplace
    )
  }

  @MainActor
  @Test func packageInstallAlwaysUsesPrivilegedHelper() {
    let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
    let prepared = makePrepared(strategy: .pkgInstall)

    #expect(coordinator.executionRoute(for: prepared) == .privilegedPackage)
  }

  @MainActor
  @Test func sparkleBypassesPrivilegedHelper() {
    let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
    let prepared = makePrepared(strategy: .sparkle)

    #expect(coordinator.executionRoute(for: prepared) == .sparkle)
  }

  private func makePrepared(
    strategy: InstallStrategy
  ) -> InstallPrepareResponse {
    InstallPrepareResponse(
      executionId: "exec_test",
      strategy: strategy,
      appId: "app_test",
      releaseId: "rel_test",
      artifact: nil
    )
  }

  private func makeWritableDestination(named name: String) throws -> URL {
    let root = FileManager.default.temporaryDirectory
      .appendingPathComponent(UUID().uuidString, isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    return root.appendingPathComponent(name, isDirectory: true)
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
