import Foundation

/// Centralizes Xcode preview-host detection so app code doesn't scatter
/// environment-variable checks across views and services.
enum PreviewRuntime {
  nonisolated static var isActive: Bool {
    isActive(environment: ProcessInfo.processInfo.environment)
  }

  nonisolated static func isActive(environment: [String: String]) -> Bool {
    environment["XCODE_RUNNING_FOR_PREVIEWS"] == "1"
      || environment["XCODE_RUNNING_FOR_PLAYGROUNDS"] == "1"
  }
}
