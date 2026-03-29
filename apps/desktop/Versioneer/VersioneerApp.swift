import SwiftUI

@main
struct VersioneerApp: App {
  @State private var appState = AppState()
  @State private var selfUpdateService = SelfUpdateService()

  init() {
    FirebaseBootstrapper.configureIfNeeded()
  }

  private var selectedMenuResult: AppDecision? {
    guard let id = appState.selectedAppID else { return nil }
    return appState.inventoryResultsByID[id]
  }

  var body: some Scene {
    Window("Versioneer", id: "main") {
      RootView()
        .environment(appState)
        .environment(appState.installCoordinator)
        .environment(selfUpdateService)
    }
    .defaultSize(width: 900, height: 560)
    .windowResizability(.contentMinSize)
    .windowToolbarStyle(.unified(showsTitle: false))
    .commands {
      // App menu
      CommandGroup(after: .appInfo) {
        Button("Check for Updates…") {
          selfUpdateService.checkForUpdates()
        }
        .disabled(!selfUpdateService.canCheckForUpdates)
      }

      // View menu — filter switching + sort
      CommandGroup(after: .toolbar) {
        Button(AppState.FilterSection.all.rawValue) {
          appState.setSelectedSection(.all)
        }
        .keyboardShortcut("1", modifiers: .command)

        Button(AppState.FilterSection.updatesAvailable.rawValue) {
          appState.setSelectedSection(.updatesAvailable)
        }
        .keyboardShortcut("2", modifiers: .command)

        Button(AppState.FilterSection.notTracked.rawValue) {
          appState.setSelectedSection(.notTracked)
        }
        .keyboardShortcut("3", modifiers: .command)

        Button(AppState.FilterSection.ignored.rawValue) {
          appState.setSelectedSection(.ignored)
        }
        .keyboardShortcut("4", modifiers: .command)

        Divider()

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

      // Apps menu — app-specific actions
      CommandMenu("Apps") {
        Button("Refresh") {
          Task { await appState.scanAndSubmit() }
        }
        .keyboardShortcut("r", modifiers: .command)

        Button("Update All") {
          Task { await appState.installAll() }
        }
        .keyboardShortcut("u", modifiers: [.command, .shift])
        .disabled(appState.updatableResults.isEmpty)

        Divider()

        Button("Open App") {
          if let result = selectedMenuResult { appState.openApp(result) }
        }
        .keyboardShortcut("o", modifiers: [.command, .shift])
        .disabled(selectedMenuResult.flatMap { appState.appPathText(for: $0) } == nil)

        Button("Show in Finder") {
          if let result = selectedMenuResult { appState.revealAppInFinder(result) }
        }
        .disabled(selectedMenuResult.flatMap { appState.appPathText(for: $0) } == nil)

        Divider()

        Button("Ignore") {
          if let result = selectedMenuResult { appState.ignore(result) }
        }
        .disabled(
          selectedMenuResult == nil
            || (selectedMenuResult.map { appState.isUserIgnored($0) } ?? true))

        Button("Unignore") {
          if let result = selectedMenuResult { appState.unignore(result) }
        }
        .disabled(
          selectedMenuResult == nil
            || !(selectedMenuResult.map { appState.isUserIgnored($0) } ?? false))

        Divider()

        Button("Copy Bundle ID") {
          if let result = selectedMenuResult { appState.copyBundleId(result) }
        }
        .keyboardShortcut("c", modifiers: [.command, .shift])
        .disabled(selectedMenuResult.flatMap { appState.bundleIdText(for: $0) } == nil)

        Button("Copy Path") {
          if let result = selectedMenuResult { appState.copyAppPath(result) }
        }
        .disabled(selectedMenuResult.flatMap { appState.appPathText(for: $0) } == nil)
      }

      // Help menu
      CommandGroup(replacing: .help) {
        Link("Versioneer Help", destination: URL(string: "https://versioneer.app")!)
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
