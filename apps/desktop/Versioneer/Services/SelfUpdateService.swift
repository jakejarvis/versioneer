import Foundation
import Logging
import Observation
import Sparkle

@MainActor
protocol SelfUpdateClient: AnyObject {
  var canCheckForUpdates: Bool { get }
  var automaticallyChecksForUpdates: Bool { get set }
  var channel: SelfUpdateChannel { get set }
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
  private(set) var channel: SelfUpdateChannel = .stable
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

  static func preview() -> SelfUpdateService {
    Self(client: PreviewSelfUpdateClient())
  }

  func setAutomaticallyChecksForUpdates(_ value: Bool) {
    guard isAvailable else { return }
    client.automaticallyChecksForUpdates = value
    syncFromClient()
  }

  func setChannel(_ value: SelfUpdateChannel) {
    client.channel = value
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
    channel = client.channel
    feedURL = client.feedURL
    lastUpdateCheckDate = client.lastUpdateCheckDate
    configurationIssue = client.configurationIssue
  }
}

@MainActor
private final class PreviewSelfUpdateClient: SelfUpdateClient {
  var onChange: (() -> Void)?
  var canCheckForUpdates = false
  var automaticallyChecksForUpdates = false
  var channel: SelfUpdateChannel = .stable
  var feedURL: URL?
  var lastUpdateCheckDate: Date?
  var configurationIssue: String? = "Unavailable in previews."

  func start() {}

  @discardableResult
  func clearFeedURLFromUserDefaults() -> URL? { nil }

  func checkForUpdates() {}
}

@MainActor
final class SparkleSelfUpdateClient: NSObject, SelfUpdateClient, SPUUpdaterDelegate {
  var onChange: (() -> Void)?

  var canCheckForUpdates: Bool {
    configurationIssue == nil && controller.updater.canCheckForUpdates
  }

  var automaticallyChecksForUpdates: Bool {
    get { controller.updater.automaticallyChecksForUpdates }
    set { controller.updater.automaticallyChecksForUpdates = newValue }
  }

  var channel: SelfUpdateChannel {
    get { channelStore.channel }
    set {
      guard channelStore.channel != newValue else { return }
      channelStore.channel = newValue
      Logger.sparkle.info("Self-update channel changed to \(newValue.rawValue)")
      onChange?()
    }
  }

  var feedURL: URL? {
    controller.updater.feedURL
  }

  var lastUpdateCheckDate: Date? {
    controller.updater.lastUpdateCheckDate as Date?
  }

  private(set) var configurationIssue: String?

  private let bundle: Bundle
  private lazy var controller = SPUStandardUpdaterController(
    startingUpdater: false,
    updaterDelegate: self,
    userDriverDelegate: nil,
  )
  private var channelStore: SelfUpdateChannelStore
  private var observations: [NSKeyValueObservation] = []
  private var started = false

  init(
    defaults: UserDefaults = .standard,
    bundle: Bundle = .main,
  ) {
    self.bundle = bundle
    self.channelStore = SelfUpdateChannelStore(defaults: defaults, bundle: bundle)
    super.init()
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
      Logger.sparkle.info(
        "Cleared Sparkle feed URL override from user defaults: \(previousFeedURL.absoluteString)")
      onChange?()
    }
    return previousFeedURL
  }

  func checkForUpdates() {
    guard started else { return }
    controller.updater.checkForUpdates()
  }

  func allowedChannels(for updater: SPUUpdater) -> Set<String> {
    channel.allowedSparkleChannels
  }

  private func installObservers() {
    observations = [
      controller.updater.observe(\.canCheckForUpdates, options: [.initial, .new]) {
        [weak self] _, _ in
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
    guard let feedURL = bundle.object(forInfoDictionaryKey: "SUFeedURL") as? String,
      !feedURL.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    else {
      return "SUFeedURL is missing from this build."
    }

    guard let publicKey = bundle.object(forInfoDictionaryKey: "SUPublicEDKey") as? String
    else {
      return "SUPublicEDKey is missing from this build."
    }

    let trimmedKey = publicKey.trimmingCharacters(in: .whitespacesAndNewlines)
    guard !trimmedKey.isEmpty, !trimmedKey.contains("$(") else {
      return "SUPublicEDKey has not been configured for this build."
    }

    return nil
  }
}
