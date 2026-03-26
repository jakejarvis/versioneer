import SwiftUI

@main
struct VersioneerApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(appState.installCoordinator)
        }
        .defaultSize(width: 1200, height: 760)
        .windowResizability(.contentMinSize)
        .windowToolbarStyle(.unified(showsTitle: false))

        Settings {
            SettingsView()
                .environment(appState)
                .environment(appState.installCoordinator)
        }
    }
}
