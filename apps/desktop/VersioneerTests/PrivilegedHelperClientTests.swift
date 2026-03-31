import Foundation
import Testing

@testable import Versioneer

struct PrivilegedHelperClientTests {
  @Test func registersHelperBeforeConnecting() async throws {
    let registration = MockRegistrationController(
      initialStatus: .notRegistered, statusAfterRegister: .enabled)
    let connection = MockConnectionProvider(
      result: PrivilegedOperationResult(
        operationType: .installPackage,
        succeeded: true,
        detail: "ok"
      ))
    let client = PrivilegedHelperClient(
      registrationController: registration,
      connectionProvider: connection
    )

    _ = try await client.performOperation(
      executionId: "exec_test",
      stagingDirectory: FileManager.default.temporaryDirectory
    )

    #expect(registration.registerCalls == 1)
    #expect(connection.requests.count == 1)
  }

  @Test func failsWhenHelperApprovalIsRequired() async {
    let client = PrivilegedHelperClient(
      registrationController: MockRegistrationController(initialStatus: .requiresApproval),
      connectionProvider: MockConnectionProvider(
        result: PrivilegedOperationResult(
          operationType: .installPackage,
          succeeded: true,
          detail: "unused"
        ))
    )

    do {
      _ = try await client.performOperation(
        executionId: "exec_test",
        stagingDirectory: FileManager.default.temporaryDirectory
      )
      Issue.record("Expected approval-required failure")
    } catch let error as InstallError {
      guard case .privilegedHelperApprovalRequired = error else {
        Issue.record("Unexpected install error: \(error.localizedDescription)")
        return
      }
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func surfacesRegistrationFailures() async {
    let client = PrivilegedHelperClient(
      registrationController: MockRegistrationController(
        initialStatus: .notRegistered,
        statusAfterRegister: .notRegistered,
        registerError: NSError(
          domain: "test", code: 1, userInfo: [NSLocalizedDescriptionKey: "boom"])
      ),
      connectionProvider: MockConnectionProvider(
        result: PrivilegedOperationResult(
          operationType: .installPackage,
          succeeded: true,
          detail: "unused"
        ))
    )

    do {
      _ = try await client.performOperation(
        executionId: "exec_test",
        stagingDirectory: FileManager.default.temporaryDirectory
      )
      Issue.record("Expected registration failure")
    } catch let error as InstallError {
      guard case .privilegedHelperRegistrationFailed(let message) = error else {
        Issue.record("Unexpected install error: \(error.localizedDescription)")
        return
      }
      #expect(message.contains("boom"))
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  @Test func surfacesConnectionInvalidationFailures() async {
    let client = PrivilegedHelperClient(
      registrationController: MockRegistrationController(initialStatus: .enabled),
      connectionProvider: MockConnectionProvider(
        livenessResult: true,
        error: InstallError.privilegedHelperConnectionFailed("invalidated"))
    )

    do {
      _ = try await client.performOperation(
        executionId: "exec_test",
        stagingDirectory: FileManager.default.temporaryDirectory
      )
      Issue.record("Expected connection failure")
    } catch let error as InstallError {
      guard case .privilegedHelperConnectionFailed(let message) = error else {
        Issue.record("Unexpected install error: \(error.localizedDescription)")
        return
      }
      #expect(message.contains("invalidated"))
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }

  // MARK: - Desync detection

  @Test func proceedsWhenHelperIsAlive() async throws {
    let client = PrivilegedHelperClient(
      registrationController: MockRegistrationController(initialStatus: .enabled),
      connectionProvider: MockConnectionProvider(
        livenessResult: true,
        result: PrivilegedOperationResult(
          operationType: .installPackage,
          succeeded: true,
          detail: "ok"
        ))
    )

    let result = try await client.performOperation(
      executionId: "exec_test",
      stagingDirectory: FileManager.default.temporaryDirectory
    )
    #expect(result.succeeded)
  }

  @Test func recoversFromDesyncViaReRegistration() async throws {
    let registration = MockRegistrationController(
      initialStatus: .enabled, statusAfterRegister: .enabled)
    // First liveness check fails (desync), second succeeds (after re-registration)
    let connection = MockConnectionProvider(
      livenessSequence: [false, true],
      result: PrivilegedOperationResult(
        operationType: .installPackage,
        succeeded: true,
        detail: "ok"
      ))
    let client = PrivilegedHelperClient(
      registrationController: registration,
      connectionProvider: connection
    )

    let result = try await client.performOperation(
      executionId: "exec_test",
      stagingDirectory: FileManager.default.temporaryDirectory
    )
    #expect(result.succeeded)
    #expect(registration.unregisterCalls == 1)
    #expect(registration.registerCalls == 1)
  }

  @Test func failsWhenDesyncRecoveryExhausted() async {
    let registration = MockRegistrationController(
      initialStatus: .enabled, statusAfterRegister: .enabled)
    // Both liveness checks fail
    let connection = MockConnectionProvider(
      livenessSequence: [false, false],
      result: PrivilegedOperationResult(
        operationType: .installPackage,
        succeeded: true,
        detail: "unused"
      ))
    let client = PrivilegedHelperClient(
      registrationController: registration,
      connectionProvider: connection
    )

    do {
      _ = try await client.performOperation(
        executionId: "exec_test",
        stagingDirectory: FileManager.default.temporaryDirectory
      )
      Issue.record("Expected connection failure")
    } catch let error as InstallError {
      guard case .privilegedHelperConnectionFailed(let message) = error else {
        Issue.record("Unexpected install error: \(error.localizedDescription)")
        return
      }
      #expect(message.contains("not responding"))
    } catch {
      Issue.record("Unexpected error: \(error.localizedDescription)")
    }
  }
}

private final class MockRegistrationController: PrivilegedHelperRegistrationControlling,
  @unchecked Sendable
{
  private(set) var registerCalls = 0
  private(set) var unregisterCalls = 0
  private let initialStatus: PrivilegedHelperRegistrationStatus
  private let statusAfterRegister: PrivilegedHelperRegistrationStatus
  private let registerError: Error?

  init(
    initialStatus: PrivilegedHelperRegistrationStatus,
    statusAfterRegister: PrivilegedHelperRegistrationStatus? = nil,
    registerError: Error? = nil
  ) {
    self.initialStatus = initialStatus
    self.statusAfterRegister = statusAfterRegister ?? initialStatus
    self.registerError = registerError
  }

  var status: PrivilegedHelperRegistrationStatus {
    registerCalls > 0 ? statusAfterRegister : initialStatus
  }

  func register() throws {
    registerCalls += 1
    if let registerError {
      throw registerError
    }
  }

  func unregister() throws {
    unregisterCalls += 1
  }
}

private final class MockConnectionProvider: PrivilegedHelperConnectionProviding, @unchecked Sendable
{
  private(set) var requests: [PrivilegedOperationRequest] = []
  private let result: PrivilegedOperationResult?
  private let error: Error?
  private var livenessResults: [Bool]
  private var livenessIndex = 0

  init(
    livenessResult: Bool = true,
    result: PrivilegedOperationResult? = nil,
    error: Error? = nil
  ) {
    self.livenessResults = [livenessResult]
    self.result = result
    self.error = error
  }

  init(
    livenessSequence: [Bool],
    result: PrivilegedOperationResult? = nil,
    error: Error? = nil
  ) {
    self.livenessResults = livenessSequence
    self.result = result
    self.error = error
  }

  func checkLiveness() async -> Bool {
    let index = livenessIndex
    livenessIndex += 1
    if index < livenessResults.count {
      return livenessResults[index]
    }
    return livenessResults.last ?? true
  }

  func perform(request: PrivilegedOperationRequest) async throws -> PrivilegedOperationResult {
    requests.append(request)
    if let error {
      throw error
    }
    return result
      ?? PrivilegedOperationResult(
        operationType: .installPackage,
        succeeded: true,
        detail: "ok"
      )
  }
}
