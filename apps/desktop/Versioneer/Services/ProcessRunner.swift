import Foundation

struct CommandResult: Sendable {
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
            let process = Process()
            process.executableURL = URL(fileURLWithPath: launchPath)
            process.arguments = arguments
            process.currentDirectoryURL = currentDirectoryURL

            let stdoutPipe = Pipe()
            let stderrPipe = Pipe()
            process.standardOutput = stdoutPipe
            process.standardError = stderrPipe

            process.terminationHandler = { process in
                let stdoutData = stdoutPipe.fileHandleForReading.readDataToEndOfFile()
                let stderrData = stderrPipe.fileHandleForReading.readDataToEndOfFile()
                let stdout = String(data: stdoutData, encoding: .utf8) ?? ""
                let stderr = String(data: stderrData, encoding: .utf8) ?? ""
                continuation.resume(returning: CommandResult(
                    stdout: stdout,
                    stderr: stderr,
                    terminationStatus: process.terminationStatus
                ))
            }

            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
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
