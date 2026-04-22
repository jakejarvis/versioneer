import Foundation
import Logging
import PostHog

nonisolated final class PostHogTelemetryCollectionState: @unchecked Sendable {
  private let lock = NSLock()
  private var analyticsEnabled = true
  private var crashReportingEnabled = true

  func update(analyticsEnabled: Bool, crashReportingEnabled: Bool) {
    lock.lock()
    self.analyticsEnabled = analyticsEnabled
    self.crashReportingEnabled = crashReportingEnabled
    lock.unlock()
  }

  func shouldSend(eventName: String) -> Bool {
    lock.lock()
    defer { lock.unlock() }

    if eventName == "$exception" {
      return crashReportingEnabled
    }
    return analyticsEnabled
  }

  var anyCollectionEnabled: Bool {
    lock.lock()
    defer { lock.unlock() }
    return analyticsEnabled || crashReportingEnabled
  }
}

@MainActor
protocol PostHogTelemetryClient: AnyObject {
  var didSetup: Bool { get }

  func setup(
    apiKey: String,
    host: String,
    commonProperties: [String: Any],
    collectionState: PostHogTelemetryCollectionState,
    optOut: Bool
  )
  func setOptedOut(_ optedOut: Bool)
  func capture(_ event: String, properties: [String: Any])
  func captureScreen(_ name: String, properties: [String: Any])
  func captureException(_ error: Error, properties: [String: Any])
  func flush()
}

@MainActor
final class PostHogSDKTelemetryClient: PostHogTelemetryClient {
  private(set) var didSetup = false

  func setup(
    apiKey: String,
    host: String,
    commonProperties: [String: Any],
    collectionState: PostHogTelemetryCollectionState,
    optOut: Bool
  ) {
    guard !didSetup else { return }

    let config = PostHogConfig(apiKey: apiKey, host: host)
    config.captureApplicationLifecycleEvents = true
    config.captureScreenViews = false
    config.errorTrackingConfig.autoCapture = true
    config.optOut = optOut

    let state = collectionState
    config.setBeforeSend { event in
      state.shouldSend(eventName: event.event) ? event : nil
    }

    PostHogSDK.shared.setup(config)
    PostHogSDK.shared.register(commonProperties)
    didSetup = true
  }

  func setOptedOut(_ optedOut: Bool) {
    if optedOut {
      PostHogSDK.shared.optOut()
    } else {
      PostHogSDK.shared.optIn()
    }
  }

  func capture(_ event: String, properties: [String: Any]) {
    PostHogSDK.shared.capture(event, properties: properties)
  }

  func captureScreen(_ name: String, properties: [String: Any]) {
    PostHogSDK.shared.screen(name, properties: properties)
  }

  func captureException(_ error: Error, properties: [String: Any]) {
    PostHogSDK.shared.captureException(error, properties: properties)
  }

  func flush() {
    PostHogSDK.shared.flush()
  }
}

@MainActor
enum PostHogTelemetry {
  static let defaultHost = PostHogConfig.defaultHost

  private static let projectTokenInfoKey = "PostHogProjectToken"
  private static let hostInfoKey = "PostHogHost"
  private static let collectionState = PostHogTelemetryCollectionState()
  private static var client: PostHogTelemetryClient = PostHogSDKTelemetryClient()
  private static var didLogMissingToken = false

  struct ResolvedConfiguration: Equatable {
    let projectToken: String
    let host: String
  }

  static func configureIfNeeded(
    analyticsEnabled: Bool,
    crashReportingEnabled: Bool,
    infoDictionary: [String: Any]? = Bundle.main.infoDictionary
  ) {
    collectionState.update(
      analyticsEnabled: analyticsEnabled,
      crashReportingEnabled: crashReportingEnabled
    )

    if client.didSetup {
      client.setOptedOut(!collectionState.anyCollectionEnabled)
      return
    }

    guard let configuration = resolveConfiguration(infoDictionary: infoDictionary) else {
      if !didLogMissingToken {
        Logger.app.warning(
          "Skipping PostHog setup because PostHogProjectToken is not set in Info.plist."
        )
        didLogMissingToken = true
      }
      return
    }

    client.setup(
      apiKey: configuration.projectToken,
      host: configuration.host,
      commonProperties: commonProperties(infoDictionary: infoDictionary),
      collectionState: collectionState,
      optOut: !collectionState.anyCollectionEnabled
    )
  }

  static func capture(_ event: String, properties: [String: Any] = [:]) {
    guard client.didSetup, collectionState.shouldSend(eventName: event) else { return }
    client.capture(event, properties: properties)
  }

  static func screen(_ name: String, properties: [String: Any] = [:]) {
    guard client.didSetup, collectionState.shouldSend(eventName: "$screen") else { return }
    client.captureScreen(name, properties: properties)
  }

  static func captureException(_ error: Error, properties: [String: Any] = [:]) {
    guard client.didSetup, collectionState.shouldSend(eventName: "$exception") else { return }
    client.captureException(error, properties: properties)
  }

  static func flush() {
    guard client.didSetup else { return }
    client.flush()
  }

  static func resolveConfiguration(
    infoDictionary: [String: Any]?
  ) -> ResolvedConfiguration? {
    guard
      let projectToken = concreteValue(
        infoDictionary?[projectTokenInfoKey] as? String
      )
    else {
      return nil
    }

    let host =
      concreteValue(
        infoDictionary?[hostInfoKey] as? String
      ) ?? defaultHost

    return ResolvedConfiguration(projectToken: projectToken, host: host)
  }

  static func resetForTesting(client testClient: PostHogTelemetryClient) {
    client = testClient
    collectionState.update(analyticsEnabled: true, crashReportingEnabled: true)
    didLogMissingToken = false
  }

  private static func commonProperties(infoDictionary: [String: Any]?) -> [String: Any] {
    var properties: [String: Any] = [
      "app_channel": "desktop",
      "platform": "macos",
      "bundle_id": Bundle.main.bundleIdentifier ?? "unknown",
    ]

    if let appVersion = infoDictionary?["CFBundleShortVersionString"] as? String {
      properties["app_version"] = appVersion
    }

    if let buildNumber = infoDictionary?["CFBundleVersion"] as? String {
      properties["build_number"] = buildNumber
    }

    return properties
  }

  private static func concreteValue(_ candidates: String?...) -> String? {
    for candidate in candidates {
      guard let value = candidate?.trimmingCharacters(in: .whitespacesAndNewlines),
        !value.isEmpty,
        !value.contains("$(")
      else {
        continue
      }
      return value
    }
    return nil
  }
}
