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
