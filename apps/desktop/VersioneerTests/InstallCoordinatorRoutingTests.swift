import Foundation
import Testing
@testable import Versioneer

struct InstallCoordinatorRoutingTests {
    @MainActor
    @Test func nonAdminReplaceStaysLocal() throws {
        let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
        let plan = makePlan(strategy: .zipReplace, requiresAdmin: false)
        let destination = try makeWritableDestination(named: "Local.app")

        #expect(coordinator.executionRoute(for: plan, destinationAppURL: destination) == .localReplace)
    }

    @MainActor
    @Test func adminReplaceUsesPrivilegedHelper() throws {
        let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
        let plan = makePlan(strategy: .dmgCopyReplace, requiresAdmin: true)
        let destination = try makeWritableDestination(named: "Admin.app")

        #expect(coordinator.executionRoute(for: plan, destinationAppURL: destination) == .privilegedReplace)
    }

    @MainActor
    @Test func packageInstallAlwaysUsesPrivilegedHelper() {
        let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
        let plan = makePlan(strategy: .pkgInstall, requiresAdmin: false)

        #expect(coordinator.executionRoute(for: plan) == .privilegedPackage)
    }

    @MainActor
    @Test func sparkleBypassesPrivilegedHelper() {
        let coordinator = InstallCoordinator(privilegedHelperClient: NoopPrivilegedHelperClient())
        let plan = makePlan(strategy: .sparkle, requiresAdmin: false)

        #expect(coordinator.executionRoute(for: plan) == .sparkle)
    }

    private func makePlan(
        strategy: AppDecision.Install.Strategy,
        requiresAdmin: Bool
    ) -> InstallPlan {
        InstallPlan(
            executionId: "exec_test",
            appId: "app_test",
            releaseId: "rel_test",
            strategy: strategy,
            installabilityClass: .assistedReplace,
            warningLevel: .none,
            requiresQuit: true,
            requiresAdmin: requiresAdmin,
            supportsSilent: false,
            relaunchAfterInstall: true,
            artifact: nil,
            localVerification: .init(
                requireHash: false,
                requireSignature: false,
                requireNotarization: false,
                requireBundleIdMatch: false,
                requireTeamIdMatch: false,
                requireVersionMatch: false
            )
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
    func performOperation(executionId _: String, stagingDirectory _: URL) async throws -> PrivilegedOperationResult {
        PrivilegedOperationResult(operationType: nil, succeeded: true, detail: "unused")
    }
}
