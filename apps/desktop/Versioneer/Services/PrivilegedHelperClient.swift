import Foundation
@preconcurrency import ServiceManagement

nonisolated enum PrivilegedHelperRegistrationStatus: Sendable {
    case notRegistered
    case enabled
    case requiresApproval
    case notFound
}

nonisolated protocol PrivilegedHelperRegistrationControlling: Sendable {
    nonisolated var status: PrivilegedHelperRegistrationStatus { get }
    nonisolated func register() throws
}

nonisolated protocol PrivilegedHelperConnectionProviding: Sendable {
    nonisolated func perform(request: PrivilegedOperationRequest) async throws -> PrivilegedOperationResult
}

nonisolated protocol PrivilegedHelperClientProtocol: Sendable {
    nonisolated func performOperation(executionId: String, stagingDirectory: URL) async throws -> PrivilegedOperationResult
}

nonisolated struct PrivilegedHelperRegistrationController: PrivilegedHelperRegistrationControlling {
    private let appService = SMAppService.daemon(plistName: PrivilegedHelperConstants.launchDaemonPlistName)

    var status: PrivilegedHelperRegistrationStatus {
        switch appService.status {
        case .notRegistered:
            return .notRegistered
        case .enabled:
            return .enabled
        case .requiresApproval:
            return .requiresApproval
        case .notFound:
            return .notFound
        @unknown default:
            return .notFound
        }
    }

    func register() throws {
        try appService.register()
    }
}

nonisolated struct XPCPrivilegedHelperConnectionProvider: PrivilegedHelperConnectionProviding {
    func perform(request: PrivilegedOperationRequest) async throws -> PrivilegedOperationResult {
        try await withCheckedThrowingContinuation { continuation in
            let connection = NSXPCConnection(
                machServiceName: PrivilegedHelperConstants.serviceLabel,
                options: .privileged
            )
            connection.remoteObjectInterface = NSXPCInterface(with: PrivilegedInstallerXPCProtocol.self)
            if #available(macOS 13.0, *) {
                connection.setCodeSigningRequirement(PrivilegedHelperConstants.helperCodeSigningRequirement)
            }

            let lock = NSLock()
            var finished = false
            func complete(_ result: Result<PrivilegedOperationResult, Error>) {
                lock.lock()
                defer { lock.unlock() }
                guard !finished else { return }
                finished = true
                connection.invalidationHandler = nil
                connection.interruptionHandler = nil
                connection.invalidate()
                continuation.resume(with: result)
            }

            connection.invalidationHandler = {
                complete(.failure(InstallError.privilegedHelperConnectionFailed(
                    "The privileged helper connection was invalidated."
                )))
            }
            connection.interruptionHandler = {
                complete(.failure(InstallError.privilegedHelperConnectionFailed(
                    "The privileged helper connection was interrupted."
                )))
            }

            connection.resume()

            guard let proxy = connection.remoteObjectProxyWithErrorHandler({ error in
                complete(.failure(InstallError.privilegedHelperConnectionFailed(error.localizedDescription)))
            }) as? PrivilegedInstallerXPCProtocol else {
                complete(.failure(InstallError.privilegedHelperConnectionFailed(
                    "Versioneer could not create a privileged helper connection."
                )))
                return
            }

            proxy.perform(request) { result in
                guard result.succeeded else {
                    complete(.failure(InstallError.privilegedHelperExecutionFailed(
                        result.errorMessage ?? result.detail
                    )))
                    return
                }
                complete(.success(result))
            }
        }
    }
}

nonisolated struct PrivilegedHelperClient: PrivilegedHelperClientProtocol {
    private let registrationController: any PrivilegedHelperRegistrationControlling
    private let connectionProvider: any PrivilegedHelperConnectionProviding

    init(
        registrationController: any PrivilegedHelperRegistrationControlling = PrivilegedHelperRegistrationController(),
        connectionProvider: any PrivilegedHelperConnectionProviding = XPCPrivilegedHelperConnectionProvider()
    ) {
        self.registrationController = registrationController
        self.connectionProvider = connectionProvider
    }

    func performOperation(executionId: String, stagingDirectory: URL) async throws -> PrivilegedOperationResult {
        try ensureHelperIsReady()
        return try await connectionProvider.perform(request: PrivilegedOperationRequest(
            executionId: executionId,
            stagingDirectoryPath: stagingDirectory.path
        ))
    }

    private func ensureHelperIsReady() throws {
        switch registrationController.status {
        case .enabled:
            return
        case .requiresApproval:
            throw InstallError.privilegedHelperApprovalRequired
        case .notFound:
            throw InstallError.privilegedHelperRegistrationFailed(
                "Versioneer could not find its bundled privileged helper."
            )
        case .notRegistered:
            do {
                try registrationController.register()
            } catch {
                switch registrationController.status {
                case .enabled:
                    return
                case .requiresApproval:
                    throw InstallError.privilegedHelperApprovalRequired
                case .notFound:
                    throw InstallError.privilegedHelperRegistrationFailed(
                        "Versioneer could not find its bundled privileged helper."
                    )
                case .notRegistered:
                    throw InstallError.privilegedHelperRegistrationFailed(error.localizedDescription)
                }
            }

            switch registrationController.status {
            case .enabled:
                return
            case .requiresApproval:
                throw InstallError.privilegedHelperApprovalRequired
            case .notFound:
                throw InstallError.privilegedHelperRegistrationFailed(
                    "Versioneer could not find its bundled privileged helper."
                )
            case .notRegistered:
                throw InstallError.privilegedHelperRegistrationFailed(
                    "Versioneer could not register its privileged helper."
                )
            }
        }
    }
}
