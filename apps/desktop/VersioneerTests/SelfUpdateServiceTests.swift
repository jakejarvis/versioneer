import Foundation
import Testing

@testable import Versioneer

@MainActor
struct SelfUpdateServiceTests {
  @Test func syncsInitialStateFromClient() {
    let client = MockSelfUpdateClient(
      canCheckForUpdates: true,
      automaticallyChecksForUpdates: true,
      feedURL: URL(string: "https://dl.versioneer.app/appcast.xml"),
      lastUpdateCheckDate: Date(timeIntervalSince1970: 1_742_000_000)
    )

    let service = SelfUpdateService(client: client)

    #expect(client.startCallCount == 1)
    #expect(client.clearFeedURLCallCount == 1)
    #expect(service.isAvailable)
    #expect(service.canCheckForUpdates)
    #expect(service.automaticallyChecksForUpdates)
    #expect(service.feedURL == URL(string: "https://dl.versioneer.app/appcast.xml"))
    #expect(service.lastUpdateCheckDate == Date(timeIntervalSince1970: 1_742_000_000))
  }

  @Test func updatesAutomaticCheckPreferenceThroughClient() {
    let client = MockSelfUpdateClient(
      canCheckForUpdates: true,
      automaticallyChecksForUpdates: false
    )

    let service = SelfUpdateService(client: client)
    service.setAutomaticallyChecksForUpdates(true)

    #expect(client.automaticallyChecksForUpdates)
    #expect(service.automaticallyChecksForUpdates)
  }

  @Test func checkForUpdatesRoutesToClientOnlyWhenAllowed() {
    let allowedClient = MockSelfUpdateClient(canCheckForUpdates: true)
    let allowedService = SelfUpdateService(client: allowedClient)
    allowedService.checkForUpdates()

    let blockedClient = MockSelfUpdateClient(canCheckForUpdates: false)
    let blockedService = SelfUpdateService(client: blockedClient)
    blockedService.checkForUpdates()

    #expect(allowedClient.checkForUpdatesCallCount == 1)
    #expect(blockedClient.checkForUpdatesCallCount == 0)
  }

  @Test func surfacesConfigurationFailuresFromClient() {
    let client = MockSelfUpdateClient(
      canCheckForUpdates: false,
      configurationIssue: "SUPublicEDKey has not been configured for this build."
    )

    let service = SelfUpdateService(client: client)

    #expect(!service.isAvailable)
    #expect(service.configurationIssue == "SUPublicEDKey has not been configured for this build.")
    #expect(!service.canCheckForUpdates)
  }

  @Test func reactsToClientStateChanges() {
    let client = MockSelfUpdateClient(
      canCheckForUpdates: true,
      automaticallyChecksForUpdates: false
    )
    let service = SelfUpdateService(client: client)

    client.canCheckForUpdates = false
    client.automaticallyChecksForUpdates = true
    client.lastUpdateCheckDate = Date(timeIntervalSince1970: 1_743_000_000)
    client.pushChange()

    #expect(!service.canCheckForUpdates)
    #expect(service.automaticallyChecksForUpdates)
    #expect(service.lastUpdateCheckDate == Date(timeIntervalSince1970: 1_743_000_000))
  }

  @Test func previewServiceUsesPreviewSafeClient() {
    let service = SelfUpdateService.preview()

    #expect(!service.isAvailable)
    #expect(service.configurationIssue == "Unavailable in previews.")
    #expect(!service.canCheckForUpdates)
    #expect(service.feedURL == nil)
  }
}

@MainActor
private final class MockSelfUpdateClient: SelfUpdateClient {
  var canCheckForUpdates: Bool
  var automaticallyChecksForUpdates: Bool
  var feedURL: URL?
  var lastUpdateCheckDate: Date?
  var configurationIssue: String?
  var onChange: (() -> Void)?

  private(set) var startCallCount = 0
  private(set) var clearFeedURLCallCount = 0
  private(set) var checkForUpdatesCallCount = 0

  init(
    canCheckForUpdates: Bool,
    automaticallyChecksForUpdates: Bool = true,
    feedURL: URL? = nil,
    lastUpdateCheckDate: Date? = nil,
    configurationIssue: String? = nil,
  ) {
    self.canCheckForUpdates = canCheckForUpdates
    self.automaticallyChecksForUpdates = automaticallyChecksForUpdates
    self.feedURL = feedURL
    self.lastUpdateCheckDate = lastUpdateCheckDate
    self.configurationIssue = configurationIssue
  }

  func start() {
    startCallCount += 1
  }

  @discardableResult
  func clearFeedURLFromUserDefaults() -> URL? {
    clearFeedURLCallCount += 1
    return nil
  }

  func checkForUpdates() {
    checkForUpdatesCallCount += 1
  }

  func pushChange() {
    onChange?()
  }
}
