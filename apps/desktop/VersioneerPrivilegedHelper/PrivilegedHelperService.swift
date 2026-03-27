import Foundation

final class PrivilegedHelperService: NSObject, PrivilegedInstallerXPCProtocol {
  private let validator: PrivilegedOperationValidator

  init(validator: PrivilegedOperationValidator) {
    self.validator = validator
  }

  func perform(
    _ request: PrivilegedOperationRequest,
    withReply reply: @escaping (PrivilegedOperationResult) -> Void
  ) {
    do {
      let validatedOperation = try validator.validate(request: request)
      let executionResult = try execute(validatedOperation: validatedOperation)
      reply(
        PrivilegedOperationResult(
          operationType: validatedOperation.manifest.operationType,
          succeeded: true,
          detail: executionResult.detail,
          usedRollback: executionResult.usedRollback,
          output: executionResult.output
        ))
    } catch {
      reply(
        PrivilegedOperationResult(
          operationType: nil,
          succeeded: false,
          detail: "Privileged operation failed.",
          errorMessage: error.localizedDescription,
          usedRollback: false,
          output: nil
        ))
    }
  }

  private func execute(
    validatedOperation: ValidatedPrivilegedOperation
  ) throws -> PrivilegedOperationExecutionResult {
    switch validatedOperation.manifest.operationType {
    case .replaceApp:
      guard let destinationURL = validatedOperation.destinationURL,
        let backupURL = validatedOperation.backupURL
      else {
        throw PrivilegedOperationValidationError.backupPathInvalid(
          "Privileged app replacement requires a backup path inside staging."
        )
      }

      return try PrivilegedOperationPerformer.replaceApp(
        sourceURL: validatedOperation.sourceURL,
        destinationURL: destinationURL,
        backupURL: backupURL
      )

    case .installPackage:
      return try PrivilegedOperationPerformer.installPackage(
        packageURL: validatedOperation.sourceURL,
        target: validatedOperation.manifest.installTarget ?? "/"
      )
    }
  }
}
