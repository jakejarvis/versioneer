import SwiftUI

struct ScannerAnimationView: View {
  @Environment(AppState.self) private var appState
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  @State private var revealedCount = 0

  private let gridColumns = Array(repeating: GridItem(.fixed(48), spacing: 12), count: 6)

  var body: some View {
    VStack(spacing: 24) {
      Spacer()

      VStack(spacing: 16) {
        Image(systemName: "magnifyingglass")
          .font(.system(size: 36, weight: .light))
          .foregroundStyle(.secondary)
          .if(!reduceMotion) { $0.symbolEffect(.pulse, options: .repeating) }

        VStack(spacing: 6) {
          Text("Discovering your apps…")
            .font(.title3.weight(.medium))
            .foregroundStyle(.primary)

          Text("Checking /Applications and ~/Applications")
            .font(.callout)
            .foregroundStyle(.secondary)
        }
      }

      if !appState.installedApps.isEmpty {
        LazyVGrid(columns: gridColumns, spacing: 12) {
          ForEach(Array(appState.installedApps.prefix(24).enumerated()), id: \.offset) {
            index,
            app in
            appIconTile(app: app, index: index)
          }
        }
        .padding(.horizontal, 32)
      }

      Spacer()
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .accessibilityElement(children: .ignore)
    .accessibilityLabel("Scanning for installed applications")
    .task {
      revealedCount = 0
      let maxCount = min(appState.installedApps.count, 24)
      guard maxCount > 0 else { return }
      for i in 1...maxCount {
        try? await Task.sleep(for: .milliseconds(60))
        guard !Task.isCancelled else { return }
        revealedCount = i
      }
    }
  }

  private func appIconTile(app: InstalledApp, index: Int) -> some View {
    let isRevealed = index < revealedCount

    return Image(nsImage: appState.appIcon(for: appDecisionStub(app)))
      .resizable()
      .aspectRatio(contentMode: .fit)
      .frame(width: 40, height: 40)
      .opacity(isRevealed ? 1 : 0)
      .scaleEffect(reduceMotion ? 1 : (isRevealed ? 1 : 0.6))
      .animation(
        reduceMotion
          ? .easeInOut(duration: 0.15)
          : .spring(duration: 0.35, bounce: 0.3).delay(Double(index) * 0.02),
        value: isRevealed
      )
  }

  private func appDecisionStub(_ app: InstalledApp) -> InventoryResult {
    InventoryResult(
      appName: app.name,
      bundleId: app.bundleId,
      installedVersion: app.version,
      matchedAppId: nil,
      matchedAppName: nil,
      matchConfidence: nil,
      decision: .localOnly,
      trackingState: .localOnly,
      localReasonCode: .notFound,
      latestVersion: nil,
      latestVersionRaw: nil,
      latestReleaseId: nil,
      channel: nil,
      availableChannels: nil,
      homebrewCaskToken: nil,
      releasedAt: nil,
      staleSince: nil,
      iconUrl: nil,
      artifact: nil,
      installStrategy: nil
    )
  }

}
