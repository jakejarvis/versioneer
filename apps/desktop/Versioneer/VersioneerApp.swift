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

  private func filterSectionToggle(
    _ section: AppState.FilterSection,
    shortcut: KeyEquivalent
  ) -> some View {
    Toggle(
      section.rawValue,
      isOn: Binding(
        get: { appState.selectedSection == section },
        set: { if $0 { appState.setSelectedSection(section) } }
      )
    )
    .keyboardShortcut(shortcut, modifiers: .command)
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
      appCommands
      viewCommands
      appsCommands
      helpCommands
    }

    Settings {
      SettingsView()
        .environment(appState)
        .environment(appState.installCoordinator)
        .environment(selfUpdateService)
    }
  }

  @CommandsBuilder
  private var appCommands: some Commands {
    CommandGroup(after: .appInfo) {
      Button("Check for Updates…") {
        selfUpdateService.checkForUpdates()
      }
      .disabled(!selfUpdateService.canCheckForUpdates)
    }
  }

  @CommandsBuilder
  private var viewCommands: some Commands {
    CommandGroup(after: .toolbar) {
      filterSectionToggle(.all, shortcut: "1")
      filterSectionToggle(.updatesAvailable, shortcut: "2")
      filterSectionToggle(.localOnly, shortcut: "3")
      filterSectionToggle(.needsReview, shortcut: "4")
      filterSectionToggle(.ignored, shortcut: "5")

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
  }

  @CommandsBuilder
  private var appsCommands: some Commands {
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
      .keyboardShortcut("f", modifiers: [.command, .shift])
      .disabled(selectedMenuResult.flatMap { appState.appPathText(for: $0) } == nil)

      Divider()

      Button("Ignore") {
        if let result = selectedMenuResult {
          appState.ignore(result, undoManager: appState.windowUndoManager)
        }
      }
      .keyboardShortcut(.delete, modifiers: .command)
      .disabled(
        selectedMenuResult == nil
          || (selectedMenuResult.map { appState.isUserIgnored($0) } ?? true))

      Button("Unignore") {
        if let result = selectedMenuResult {
          appState.unignore(result, undoManager: appState.windowUndoManager)
        }
      }
      .keyboardShortcut(.delete, modifiers: [.command, .shift])
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
      .keyboardShortcut("c", modifiers: [.command, .option])
      .disabled(selectedMenuResult.flatMap { appState.appPathText(for: $0) } == nil)
    }
  }

  @CommandsBuilder
  private var helpCommands: some Commands {
    CommandGroup(after: .help) {
      Link("Versioneer Website", destination: URL(string: "https://versioneer.app")!)
    }
  }
}
