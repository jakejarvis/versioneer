import Logging

extension Logger {
  nonisolated static let app = Logger(label: "com.jakejarvis.versioneer.App")
  nonisolated static let appScanner = Logger(label: "com.jakejarvis.versioneer.AppScanner")
  nonisolated static let api = Logger(label: "com.jakejarvis.versioneer.API")
  nonisolated static let feedback = Logger(label: "com.jakejarvis.versioneer.Feedback")
  nonisolated static let cache = Logger(label: "com.jakejarvis.versioneer.Cache")
  nonisolated static let sparkle = Logger(label: "com.jakejarvis.versioneer.Sparkle")
  nonisolated static let electron = Logger(label: "com.jakejarvis.versioneer.Electron")
  nonisolated static let homebrew = Logger(label: "com.jakejarvis.versioneer.Homebrew")
  nonisolated static let install = Logger(label: "com.jakejarvis.versioneer.Install")
  nonisolated static let mas = Logger(label: "com.jakejarvis.versioneer.MAS")
  nonisolated static let attest = Logger(label: "com.jakejarvis.versioneer.Attest")
}
