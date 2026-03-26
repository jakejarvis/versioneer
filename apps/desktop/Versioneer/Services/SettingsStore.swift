import Foundation
import Observation

/// Persists lightweight user settings using UserDefaults.
@Observable
@MainActor
final class SettingsStore {
    private let defaults = UserDefaults.standard

    private enum Keys {
        static let baseURL = "versioneer_base_url"
        static let scanOnLaunch = "versioneer_scan_on_launch"
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

    var scanOnLaunch: Bool {
        get {
            if defaults.object(forKey: Keys.scanOnLaunch) == nil { return true }
            return defaults.bool(forKey: Keys.scanOnLaunch)
        }
        set {
            defaults.set(newValue, forKey: Keys.scanOnLaunch)
        }
    }

    /// Resets the base URL to the default value.
    func resetBaseURL() {
        defaults.removeObject(forKey: Keys.baseURL)
    }
}
