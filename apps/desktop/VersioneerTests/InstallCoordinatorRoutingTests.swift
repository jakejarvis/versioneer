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
