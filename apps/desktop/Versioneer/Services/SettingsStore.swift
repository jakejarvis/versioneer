import Foundation
import Observation

/// Persists lightweight user settings using UserDefaults.
@Observable
final class SettingsStore: @unchecked Sendable {
    private let defaults = UserDefaults.standard

    private enum Keys {
        static let baseURL = "versioneer_base_url"
    }

    static let defaultBaseURL = URL(string: "https://api.versioneer.app")!

    var baseURL: URL {
        get {
            if let string = defaults.string(forKey: Keys.baseURL),
               let url = URL(string: string) {
                return url
            }
            return Self.defaultBaseURL
        }
        set {
            defaults.set(newValue.absoluteString, forKey: Keys.baseURL)
        }
    }

    /// Resets the base URL to the default value.
    func resetBaseURL() {
        defaults.removeObject(forKey: Keys.baseURL)
    }
}
