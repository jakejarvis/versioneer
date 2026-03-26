import FirebaseAnalytics
import SwiftUI

extension View {
    func versioneerAnalyticsScreen(name: String, class screenClass: String) -> some View {
        analyticsScreen(
            name: name,
            class: screenClass,
            extraParameters: [
                "app_channel": "desktop",
                "platform": "macos",
            ]
        )
    }
}
