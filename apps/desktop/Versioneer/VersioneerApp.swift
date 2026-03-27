import SwiftUI

@main
struct VersioneerApp: App {
    @NSApplicationDelegateAdaptor(FirebaseAppDelegate.self) private var firebaseAppDelegate
    @State private var appState = AppState()
    @State private var selfUpdateService = SelfUpdateService()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(appState)
                .environment(appState.installCoordinator)
                .environment(selfUpdateService)
        }
        .defaultSize(width: 1200, height: 760)
        .windowResizability(.contentMinSize)
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands {
            CommandGroup(after: .appInfo) {
                Button("Check for Updates…") {
                    selfUpdateService.checkForUpdates()
                }
                .disabled(!selfUpdateService.canCheckForUpdates)
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
