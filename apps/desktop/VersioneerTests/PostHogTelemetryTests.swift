import Foundation
import Testing

@testable import Versioneer

@Suite(.serialized)
@MainActor
struct PostHogTelemetryTests {
  @Test func missingProjectTokenNoops() {
    let client = SpyPostHogTelemetryClient()
    PostHogTelemetry.resetForTesting(client: client)

    PostHogTelemetry.configureIfNeeded(
      analyticsEnabled: true,
      crashReportingEnabled: true,
      infoDictionary: [:]
    )
    PostHogTelemetry.capture("desktop_scan_started")
    PostHogTelemetry.captureException(TestTelemetryError.sample)

    #expect(!client.didSetup)
    #expect(client.capturedEvents.isEmpty)
    #expect(client.capturedExceptions.isEmpty)
  }

  @Test func missingHostFallsBackToUSCloud() {
    let client = SpyPostHogTelemetryClient()
    PostHogTelemetry.resetForTesting(client: client)

    PostHogTelemetry.configureIfNeeded(
      analyticsEnabled: true,
      crashReportingEnabled: true,
      infoDictionary: [
        "PostHogProjectToken": " phc_test "
      ]
    )

    #expect(client.didSetup)
    #expect(client.setupApiKey == "phc_test")
    #expect(client.setupHost == PostHogTelemetry.defaultHost)
    #expect(client.setupOptOut == false)
  }

  @Test func packagedInfoDictionaryValuesConfigurePostHog() {
    let client = SpyPostHogTelemetryClient()
    PostHogTelemetry.resetForTesting(client: client)

    PostHogTelemetry.configureIfNeeded(
      analyticsEnabled: true,
      crashReportingEnabled: true,
      infoDictionary: [
        "PostHogProjectToken": "phc_packaged",
        "PostHogHost": "https://eu.i.posthog.com",
      ]
    )

    #expect(client.didSetup)
    #expect(client.setupApiKey == "phc_packaged")
    #expect(client.setupHost == "https://eu.i.posthog.com")
  }

  @Test func eventAndErrorCaptureHonorCollectionToggles() {
    let client = SpyPostHogTelemetryClient()
    PostHogTelemetry.resetForTesting(client: client)

    PostHogTelemetry.configureIfNeeded(
      analyticsEnabled: false,
      crashReportingEnabled: true,
      infoDictionary: [
        "PostHogProjectToken": "phc_test"
      ]
    )
    PostHogTelemetry.capture("desktop_scan_started")
    PostHogTelemetry.captureException(TestTelemetryError.sample)

    #expect(client.capturedEvents.isEmpty)
    #expect(client.capturedExceptions.count == 1)

    PostHogTelemetry.configureIfNeeded(
      analyticsEnabled: true,
      crashReportingEnabled: false,
      infoDictionary: [:]
    )
    PostHogTelemetry.capture("desktop_scan_completed")
    PostHogTelemetry.captureException(TestTelemetryError.sample)

    #expect(client.capturedEvents.map(\.event) == ["desktop_scan_completed"])
    #expect(client.capturedExceptions.count == 1)
  }
}

private enum TestTelemetryError: Error {
  case sample
}

@MainActor
private final class SpyPostHogTelemetryClient: PostHogTelemetryClient {
  private(set) var didSetup = false
  private(set) var setupApiKey: String?
  private(set) var setupHost: String?
  private(set) var setupOptOut: Bool?
  private(set) var optedOutValues: [Bool] = []
  private(set) var capturedEvents: [(event: String, properties: [String: Any])] = []
  private(set) var capturedScreens: [(name: String, properties: [String: Any])] = []
  private(set) var capturedExceptions: [(error: Error, properties: [String: Any])] = []
  private(set) var flushCount = 0

  func setup(
    apiKey: String,
    host: String,
    commonProperties: [String: Any],
    collectionState: PostHogTelemetryCollectionState,
    optOut: Bool
  ) {
    didSetup = true
    setupApiKey = apiKey
    setupHost = host
    setupOptOut = optOut
  }

  func setOptedOut(_ optedOut: Bool) {
    optedOutValues.append(optedOut)
  }

  func capture(_ event: String, properties: [String: Any]) {
    capturedEvents.append((event, properties))
  }

  func captureScreen(_ name: String, properties: [String: Any]) {
    capturedScreens.append((name, properties))
  }

  func captureException(_ error: Error, properties: [String: Any]) {
    capturedExceptions.append((error, properties))
  }

  func flush() {
    flushCount += 1
  }
}
