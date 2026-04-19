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
    .frame(minWidth: 560, idealWidth: 600, maxWidth: 680, minHeight: 420, idealHeight: 460, maxHeight: 680)
    .versioneerAnalyticsScreen(name: "settings", class: "SettingsView")
  }
}
