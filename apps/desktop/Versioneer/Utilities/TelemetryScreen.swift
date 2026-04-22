import SwiftUI

extension View {
  func versioneerTelemetryScreen(name: String, screenClass: String) -> some View {
    onAppear {
      PostHogTelemetry.screen(
        name,
        properties: [
          "screen_class": screenClass
        ]
      )
    }
  }
}
