import Foundation

private nonisolated final class ProcessPipeBuffer: @unchecked Sendable {
  var data = Data()
}

nonisolated struct CommandResult: Sendable {
  let stdout: String
  let stderr: String
  let terminationStatus: Int32
}

enum CommandRunnerError: LocalizedError {
  case failed(command: String, status: Int32, stderr: String)

  var errorDescription: String? {
    switch self {
    case .failed(let command, let status, let stderr):
      if stderr.isEmpty {
        return "Command failed (\(status)): \(command)"
      }
      return "Command failed (\(status)): \(command)\n\(stderr)"
    }
  }
}

enum ProcessRunner {
  static func run(
    _ launchPath: String,
    arguments: [String],
    currentDirectoryURL: URL? = nil
  ) async throws -> CommandResult {
    try await withCheckedThrowingContinuation { continuation in
      DispatchQueue.global(qos: .userInitiated).async {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: launchPath)
        process.arguments = arguments
        process.currentDirectoryURL = currentDirectoryURL

        let stdoutPipe = Pipe()
        let stderrPipe = Pipe()
        process.standardOutput = stdoutPipe
        process.standardError = stderrPipe

        let stdoutBuffer = ProcessPipeBuffer()
        let stderrBuffer = ProcessPipeBuffer()
        let drainGroup = DispatchGroup()

        func startDraining(_ pipe: Pipe, into buffer: ProcessPipeBuffer) {
          drainGroup.enter()
          DispatchQueue.global(qos: .userInitiated).async {
            buffer.data = pipe.fileHandleForReading.readDataToEndOfFile()
            drainGroup.leave()
          }
        }

        do {
          try process.run()
          startDraining(stdoutPipe, into: stdoutBuffer)
          startDraining(stderrPipe, into: stderrBuffer)

          process.waitUntilExit()
          drainGroup.wait()

          let stdout = String(data: stdoutBuffer.data, encoding: .utf8) ?? ""
          let stderr = String(data: stderrBuffer.data, encoding: .utf8) ?? ""
          continuation.resume(
            returning: CommandResult(
              stdout: stdout,
              stderr: stderr,
              terminationStatus: process.terminationStatus
            ))
        } catch {
          continuation.resume(throwing: error)
        }
      }
    }
  }

  @discardableResult
  static func runSuccessful(
    _ launchPath: String,
    arguments: [String],
    currentDirectoryURL: URL? = nil
  ) async throws -> CommandResult {
    let result = try await run(
      launchPath,
      arguments: arguments,
      currentDirectoryURL: currentDirectoryURL
    )
    guard result.terminationStatus == 0 else {
      let renderedCommand = ([launchPath] + arguments).joined(separator: " ")
      throw CommandRunnerError.failed(
        command: renderedCommand,
        status: result.terminationStatus,
        stderr: result.stderr.isEmpty ? result.stdout : result.stderr
      )
    }
    return result
  }
}
