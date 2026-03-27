import Foundation
import Logging
import Observation
import Sparkle

@MainActor
protocol SelfUpdateClient: AnyObject {
    var canCheckForUpdates: Bool { get }
    var automaticallyChecksForUpdates: Bool { get set }
    var feedURL: URL? { get }
    var lastUpdateCheckDate: Date? { get }
    var configurationIssue: String? { get }
    var onChange: (() -> Void)? { get set }

    func start()
    @discardableResult
    func clearFeedURLFromUserDefaults() -> URL?
    func checkForUpdates()
}

@Observable
@MainActor
final class SelfUpdateService {
    private let client: any SelfUpdateClient

    private(set) var canCheckForUpdates = false
    private(set) var automaticallyChecksForUpdates = false
    private(set) var feedURL: URL?
    private(set) var lastUpdateCheckDate: Date?
    private(set) var configurationIssue: String?

    var isAvailable: Bool {
        configurationIssue == nil
    }

    init(client: any SelfUpdateClient = SparkleSelfUpdateClient()) {
        self.client = client
        self.client.onChange = { [weak self] in
            self?.syncFromClient()
        }
        self.client.start()
        _ = self.client.clearFeedURLFromUserDefaults()
        syncFromClient()
    }

    func setAutomaticallyChecksForUpdates(_ value: Bool) {
        guard isAvailable else { return }
        client.automaticallyChecksForUpdates = value
        syncFromClient()
    }

    func checkForUpdates() {
        guard canCheckForUpdates else { return }
        client.checkForUpdates()
        syncFromClient()
    }

    private func syncFromClient() {
        canCheckForUpdates = client.canCheckForUpdates
        automaticallyChecksForUpdates = client.automaticallyChecksForUpdates
        feedURL = client.feedURL
        lastUpdateCheckDate = client.lastUpdateCheckDate
        configurationIssue = client.configurationIssue
    }
}

@MainActor
final class SparkleSelfUpdateClient: SelfUpdateClient {
    var onChange: (() -> Void)?

    var canCheckForUpdates: Bool {
        configurationIssue == nil && controller.updater.canCheckForUpdates
    }

    var automaticallyChecksForUpdates: Bool {
        get { controller.updater.automaticallyChecksForUpdates }
        set { controller.updater.automaticallyChecksForUpdates = newValue }
    }

    var feedURL: URL? {
        controller.updater.feedURL
    }

    var lastUpdateCheckDate: Date? {
        controller.updater.lastUpdateCheckDate as Date?
    }

    private(set) var configurationIssue: String?

    private let controller: SPUStandardUpdaterController
    private var observations: [NSKeyValueObservation] = []
    private var started = false

    init(controller: SPUStandardUpdaterController = SPUStandardUpdaterController(
        startingUpdater: false,
        updaterDelegate: nil,
        userDriverDelegate: nil,
    )) {
        self.controller = controller
        installObservers()
    }

    func start() {
        guard !started else { return }

        if let configurationIssue = validateConfiguration() {
            Logger.sparkle.warning("Sparkle self-update unavailable: \(configurationIssue)")
            self.configurationIssue = configurationIssue
            onChange?()
            return
        }

        controller.startUpdater()

        started = true
        configurationIssue = nil
        onChange?()
    }

    @discardableResult
    func clearFeedURLFromUserDefaults() -> URL? {
        guard started else { return nil }

        let previousFeedURL = controller.updater.clearFeedURLFromUserDefaults()
        if let previousFeedURL {
            Logger.sparkle.info("Cleared Sparkle feed URL override from user defaults: \(previousFeedURL.absoluteString)")
            onChange?()
        }
        return previousFeedURL
    }

    func checkForUpdates() {
        guard started else { return }
        controller.updater.checkForUpdates()
    }

    private func installObservers() {
        observations = [
            controller.updater.observe(\.canCheckForUpdates, options: [.initial, .new]) { [weak self] _, _ in
                Task { @MainActor [weak self] in
                    self?.onChange?()
                }
            },
            controller.updater.observe(\.automaticallyChecksForUpdates, options: [.initial, .new]) {
                [weak self] _, _ in
                Task { @MainActor [weak self] in
                    self?.onChange?()
                }
            },
        ]
    }

    private func validateConfiguration() -> String? {
        guard let feedURL = Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String,
              !feedURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return "SUFeedURL is missing from this build."
        }

        guard let publicKey = Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String else {
            return "SUPublicEDKey is missing from this build."
        }

        let trimmedKey = publicKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedKey.isEmpty, !trimmedKey.contains("$(") else {
            return "SUPublicEDKey has not been configured for this build."
        }

        return nil
    }
}
