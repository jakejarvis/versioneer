import FirebaseAnalytics
import FirebaseCore
import FirebaseCrashlytics
import Foundation
import Logging

@MainActor
enum FirebaseBootstrapper {
  private static var isConfigured = false

  static func configureIfNeeded(
    analyticsEnabled: Bool,
    crashlyticsEnabled: Bool
  ) {
    guard Bundle.main.url(forResource: "GoogleService-Info", withExtension: "plist") != nil else {
      Logger.app.info(
        "Skipping Firebase setup because GoogleService-Info.plist is missing from the app bundle.")
      return
    }

    if !isConfigured {
      guard FirebaseApp.app() == nil else {
        isConfigured = true
        applyCollectionToggles(
          analyticsEnabled: analyticsEnabled, crashlyticsEnabled: crashlyticsEnabled)
        return
      }
      FirebaseApp.configure()
      isConfigured = true
    }

    guard FirebaseApp.app() != nil else {
      Logger.app.error("Firebase configuration did not create an app instance.")
      return
    }

    applyCollectionToggles(
      analyticsEnabled: analyticsEnabled, crashlyticsEnabled: crashlyticsEnabled)
  }

  private static func applyCollectionToggles(
    analyticsEnabled: Bool,
    crashlyticsEnabled: Bool
  ) {
    Analytics.setAnalyticsCollectionEnabled(analyticsEnabled)
    Analytics.setDefaultEventParameters([
      "app_channel": "desktop",
      "platform": "macos",
    ])

    let crashlytics = Crashlytics.crashlytics()
    crashlytics.setCrashlyticsCollectionEnabled(crashlyticsEnabled)
    crashlytics.setCustomValue("desktop", forKey: "app_channel")
    crashlytics.setCustomValue("macos", forKey: "platform")
    crashlytics.setCustomValue(Bundle.main.bundleIdentifier ?? "unknown", forKey: "bundle_id")

    if let appVersion = Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString")
      as? String
    {
      crashlytics.setCustomValue(appVersion, forKey: "app_version")
    }

    if let buildNumber = Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String {
      crashlytics.setCustomValue(buildNumber, forKey: "build_number")
    }
  }
}
