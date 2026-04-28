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
  nonisolated func unregister() throws
}

nonisolated protocol PrivilegedHelperConnectionProviding: Sendable {
  nonisolated func perform(request: PrivilegedOperationRequest) async throws
    -> PrivilegedOperationResult
  nonisolated func checkLiveness() async -> Bool
}

nonisolated protocol PrivilegedHelperClientProtocol: Sendable {
  nonisolated func performOperation(
    executionId: String,
    stagingDirectory: URL,
    manifestSHA256: String
  ) async throws -> PrivilegedOperationResult
  nonisolated func registrationStatus() -> PrivilegedHelperRegistrationStatus
}

nonisolated struct PrivilegedHelperRegistrationController: PrivilegedHelperRegistrationControlling {
  private let appService = SMAppService.daemon(
    plistName: PrivilegedHelperConstants.launchDaemonPlistName)

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

  func unregister() throws {
    try appService.unregister()
  }
}

private nonisolated final class XPCLivenessState: @unchecked Sendable {
  private let lock = NSLock()
  private var finished = false
  private let connection: NSXPCConnection
  private let continuation: CheckedContinuation<Bool, Never>

  init(connection: NSXPCConnection, continuation: CheckedContinuation<Bool, Never>) {
    self.connection = connection
    self.continuation = continuation
  }

  func complete(_ alive: Bool) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished else { return }
    finished = true
    connection.invalidationHandler = nil
    connection.interruptionHandler = nil
    connection.invalidate()
    continuation.resume(returning: alive)
  }
}

private nonisolated final class XPCOperationState: @unchecked Sendable {
  private let lock = NSLock()
  private var finished = false
  private let connection: NSXPCConnection
  private let continuation: CheckedContinuation<PrivilegedOperationResult, any Error>

  init(
    connection: NSXPCConnection,
    continuation: CheckedContinuation<PrivilegedOperationResult, any Error>
  ) {
    self.connection = connection
    self.continuation = continuation
  }

  func complete(_ result: Result<PrivilegedOperationResult, any Error>) {
    lock.lock()
    defer { lock.unlock() }
    guard !finished else { return }
    finished = true
    connection.invalidationHandler = nil
    connection.interruptionHandler = nil
    connection.invalidate()
    continuation.resume(with: result)
  }
}

nonisolated struct XPCPrivilegedHelperConnectionProvider: PrivilegedHelperConnectionProviding {
  /// Pings the helper to check if it is alive. Returns false if the connection fails or times out.
  func checkLiveness() async -> Bool {
    await withCheckedContinuation { continuation in
      let connection = NSXPCConnection(
        machServiceName: PrivilegedHelperConstants.serviceLabel,
        options: .privileged
      )
      connection.remoteObjectInterface = NSXPCInterface(with: PrivilegedInstallerXPCProtocol.self)
      if #available(macOS 13.0, *) {
        connection.setCodeSigningRequirement(PrivilegedHelperConstants.helperCodeSigningRequirement)
      }

      let state = XPCLivenessState(connection: connection, continuation: continuation)

      // 5-second timeout
      DispatchQueue.global().asyncAfter(deadline: .now() + 5) {
        state.complete(false)
      }

      connection.invalidationHandler = { state.complete(false) }
      connection.interruptionHandler = { state.complete(false) }
      connection.resume()

      guard
        let proxy = connection.remoteObjectProxyWithErrorHandler({ _ in
          state.complete(false)
        }) as? PrivilegedInstallerXPCProtocol
      else {
        state.complete(false)
        return
      }

      proxy.ping { alive in
        state.complete(alive)
      }
    }
  }

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

      let state = XPCOperationState(connection: connection, continuation: continuation)

      connection.invalidationHandler = {
        state.complete(
          .failure(
            InstallError.privilegedHelperConnectionFailed(
              "The privileged helper connection was invalidated."
            )))
      }
      connection.interruptionHandler = {
        state.complete(
          .failure(
            InstallError.privilegedHelperConnectionFailed(
              "The privileged helper connection was interrupted."
            )))
      }

      connection.resume()

      guard
        let proxy = connection.remoteObjectProxyWithErrorHandler({ error in
          state.complete(
            .failure(InstallError.privilegedHelperConnectionFailed(error.localizedDescription)))
        }) as? PrivilegedInstallerXPCProtocol
      else {
        state.complete(
          .failure(
            InstallError.privilegedHelperConnectionFailed(
              "Versioneer could not create a privileged helper connection."
            )))
        return
      }

      proxy.perform(request) { result in
        guard result.succeeded else {
          state.complete(
            .failure(
              InstallError.privilegedHelperExecutionFailed(
                result.errorMessage ?? result.detail
              )))
          return
        }
        state.complete(.success(result))
      }
    }
  }
}

nonisolated struct PrivilegedHelperClient: PrivilegedHelperClientProtocol {
  private let registrationController: any PrivilegedHelperRegistrationControlling
  private let connectionProvider: any PrivilegedHelperConnectionProviding

  init(
    registrationController: any PrivilegedHelperRegistrationControlling =
      PrivilegedHelperRegistrationController(),
    connectionProvider: any PrivilegedHelperConnectionProviding =
      XPCPrivilegedHelperConnectionProvider()
  ) {
    self.registrationController = registrationController
    self.connectionProvider = connectionProvider
  }

  func performOperation(
    executionId: String,
    stagingDirectory: URL,
    manifestSHA256: String
  ) async throws -> PrivilegedOperationResult {
    try await ensureHelperIsReady()
    return try await connectionProvider.perform(
      request: PrivilegedOperationRequest(
        executionId: executionId,
        stagingDirectoryPath: stagingDirectory.path,
        manifestSHA256: manifestSHA256
      ))
  }

  func registrationStatus() -> PrivilegedHelperRegistrationStatus {
    registrationController.status
  }

  private func ensureHelperIsReady() async throws {
    switch registrationController.status {
    case .enabled:
      // Liveness check: verify the helper is actually responding
      if await connectionProvider.checkLiveness() {
        return
      }
      // Desync detected — try to recover via re-registration
      try? registrationController.unregister()
      do {
        try registrationController.register()
      } catch {
        throw InstallError.privilegedHelperConnectionFailed(
          "The privileged helper is registered but not responding, "
            + "and re-registration failed: \(error.localizedDescription)"
        )
      }
      if await connectionProvider.checkLiveness() {
        return
      }
      throw InstallError.privilegedHelperConnectionFailed(
        "The privileged helper is registered but not responding. "
          + "Try removing and re-adding Versioneer in System Settings > Login Items."
      )
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
          break
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
