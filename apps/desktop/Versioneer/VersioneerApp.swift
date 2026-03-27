import SwiftUI

@main
struct VersioneerApp: App {
  @NSApplicationDelegateAdaptor(FirebaseAppDelegate.self) private var firebaseAppDelegate
  @State private var appState = AppState()
  @State private var selfUpdateService = SelfUpdateService()

  var body: some Scene {
    Window("Versioneer", id: "main") {
      RootView()
        .environment(appState)
        .environment(appState.installCoordinator)
        .environment(selfUpdateService)
    }
    .defaultSize(width: 600, height: 500)
    .windowResizability(.contentMinSize)
    .windowToolbarStyle(.unified(showsTitle: false))
    .commands {
      CommandGroup(after: .appInfo) {
        Button("Check for Updates…") {
          selfUpdateService.checkForUpdates()
        }
        .disabled(!selfUpdateService.canCheckForUpdates)
      }
      CommandGroup(after: .toolbar) {
        @Bindable var appState = appState
        Picker("Sort By", selection: $appState.resultsSort) {
          ForEach(ResultsBrowserSort.allCases) { sort in
            Text(sort.title).tag(sort)
          }
        }
      }
    }

    Settings {
      SettingsView()
        .environment(appState)
        .environment(appState.installCoordinator)
        .environment(selfUpdateService)
    }
  }
}
