import SwiftUI

struct SettingsView: View {
  var body: some View {
    TabView {
      Tab("General", systemImage: "gear") {
        GeneralSettingsTab()
      }
      Tab("Ignored", systemImage: "minus.circle") {
        IgnoredAppsSettingsTab()
      }
      Tab("Advanced", systemImage: "slider.horizontal.3") {
        AdvancedSettingsTab()
      }
    }
    .scenePadding()
    .frame(width: 560, height: 440)
    .versioneerAnalyticsScreen(name: "settings", class: "SettingsView")
  }
}
