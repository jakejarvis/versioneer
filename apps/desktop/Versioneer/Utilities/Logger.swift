import Logging

extension Logger {
    nonisolated static let appScanner = Logger(label: "com.jakejarvis.Versioneer.AppScanner")
    nonisolated static let api = Logger(label: "com.jakejarvis.Versioneer.API")
    nonisolated static let feedback = Logger(label: "com.jakejarvis.Versioneer.Feedback")
    nonisolated static let cache = Logger(label: "com.jakejarvis.Versioneer.Cache")
    nonisolated static let sparkle = Logger(label: "com.jakejarvis.Versioneer.Sparkle")
    nonisolated static let electron = Logger(label: "com.jakejarvis.Versioneer.Electron")
}
