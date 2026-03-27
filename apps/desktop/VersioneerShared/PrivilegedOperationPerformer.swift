import Foundation

nonisolated struct PrivilegedOperationExecutionResult: Sendable {
  let detail: String
  let usedRollback: Bool
  let output: String?
}

nonisolated enum PrivilegedOperationExecutionError: LocalizedError {
  case commandFailed(command: String, status: Int32, output: String)

  var errorDescription: String? {
    switch self {
    case .commandFailed(let command, let status, let output):
      if output.isEmpty {
        return "Command failed (\(status)): \(command)"
      }
      return "Command failed (\(status)): \(command)\n\(output)"
    }
  }
}

nonisolated enum PrivilegedOperationPerformer {
  static func replaceApp(
    sourceURL: URL,
    destinationURL: URL,
    backupURL: URL
  ) throws -> PrivilegedOperationExecutionResult {
    let fileManager = FileManager.default
    let backupParent = backupURL.deletingLastPathComponent()
    try fileManager.createDirectory(at: backupParent, withIntermediateDirectories: true)

    var movedOriginalToBackup = false
    do {
      if fileManager.fileExists(atPath: backupURL.path) {
        try fileManager.removeItem(at: backupURL)
      }

      if fileManager.fileExists(atPath: destinationURL.path) {
        try fileManager.moveItem(at: destinationURL, to: backupURL)
        movedOriginalToBackup = true
      }

      _ = try runSuccessful("/usr/bin/ditto", arguments: [sourceURL.path, destinationURL.path])
      _ = try? runSuccessful(
        "/usr/bin/xattr", arguments: ["-dr", "com.apple.quarantine", destinationURL.path])

      if movedOriginalToBackup, fileManager.fileExists(atPath: backupURL.path) {
        try fileManager.removeItem(at: backupURL)
      }

      return PrivilegedOperationExecutionResult(
        detail: "Replaced \(destinationURL.lastPathComponent).",
        usedRollback: false,
        output: nil
      )
    } catch {
      var usedRollback = false
      if fileManager.fileExists(atPath: destinationURL.path) {
        try? fileManager.removeItem(at: destinationURL)
      }
      if movedOriginalToBackup, fileManager.fileExists(atPath: backupURL.path) {
        try? fileManager.moveItem(at: backupURL, to: destinationURL)
        usedRollback = true
      }

      if let executionError = error as? PrivilegedOperationExecutionError {
        throw PrivilegedOperationExecutionError.commandFailed(
          command: "replace_app",
          status: 1,
          output: usedRollback
            ? "\(executionError.localizedDescription)\nRollback restored the original app bundle."
            : executionError.localizedDescription
        )
      }

      throw error
    }
  }

  static func installPackage(
    packageURL: URL,
    target: String
  ) throws -> PrivilegedOperationExecutionResult {
    let output = try runSuccessful(
      "/usr/sbin/installer",
      arguments: ["-pkg", packageURL.path, "-target", target]
    )

    return PrivilegedOperationExecutionResult(
      detail: "Installed package \(packageURL.lastPathComponent).",
      usedRollback: false,
      output: [output.stdout, output.stderr]
        .filter { !$0.isEmpty }
        .joined(separator: "\n")
    )
  }

  private struct ProcessOutput {
    let stdout: String
    let stderr: String
  }

  private static func runSuccessful(
    _ executablePath: String,
    arguments: [String]
  ) throws -> ProcessOutput {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executablePath)
    process.arguments = arguments

    let stdoutPipe = Pipe()
    let stderrPipe = Pipe()
    process.standardOutput = stdoutPipe
    process.standardError = stderrPipe

    try process.run()
    process.waitUntilExit()

    let stdout =
      String(data: stdoutPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""
    let stderr =
      String(data: stderrPipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8) ?? ""

    guard process.terminationStatus == 0 else {
      throw PrivilegedOperationExecutionError.commandFailed(
        command: ([executablePath] + arguments).joined(separator: " "),
        status: process.terminationStatus,
        output: stderr.isEmpty ? stdout : stderr
      )
    }

    return ProcessOutput(stdout: stdout, stderr: stderr)
  }
}
