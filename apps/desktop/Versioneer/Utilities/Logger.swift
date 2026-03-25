import OSLog

extension Logger {
    static let appScanner = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.jakejarvis.Versioneer", category: "AppScanner")
    static let api = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.jakejarvis.Versioneer", category: "API")
    static let feedback = Logger(subsystem: Bundle.main.bundleIdentifier ?? "com.jakejarvis.Versioneer", category: "Feedback")
}
