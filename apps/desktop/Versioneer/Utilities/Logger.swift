import OSLog

extension Logger {
    nonisolated static let appScanner = Logger(subsystem: "com.jakejarvis.Versioneer", category: "AppScanner")
    nonisolated static let api = Logger(subsystem: "com.jakejarvis.Versioneer", category: "API")
    nonisolated static let feedback = Logger(subsystem: "com.jakejarvis.Versioneer", category: "Feedback")
    nonisolated static let cache = Logger(subsystem: "com.jakejarvis.Versioneer", category: "Cache")
}
