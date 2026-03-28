import SwiftUI

@main
struct VersioneerApp: App {
  @State private var appState = AppState()
  @State private var selfUpdateService = SelfUpdateService()

  init() {
    FirebaseBootstrapper.configureIfNeeded()
  }

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
        Picker(
          "Sort By",
          selection: Binding(
            get: { appState.resultsSort },
            set: { appState.setResultsSort($0) }
          )
        ) {
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
