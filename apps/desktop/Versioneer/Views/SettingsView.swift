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
    .frame(minWidth: 560, maxWidth: 560, minHeight: 400, idealHeight: 440, maxHeight: 640)
    .versioneerAnalyticsScreen(name: "settings", class: "SettingsView")
  }
}
