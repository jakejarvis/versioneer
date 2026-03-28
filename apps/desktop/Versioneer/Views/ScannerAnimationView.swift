import SwiftUI

struct ScannerAnimationView: View {
  @Environment(AppState.self) private var appState

  @State private var revealedCount = 0
  @State private var animationTimer: Timer?

  private let gridColumns = Array(repeating: GridItem(.fixed(48), spacing: 12), count: 6)

  var body: some View {
    VStack(spacing: 24) {
      Spacer()

      VStack(spacing: 16) {
        Image(systemName: "magnifyingglass")
          .font(.system(size: 36, weight: .light))
          .foregroundStyle(.secondary)
          .symbolEffect(.pulse, options: .repeating)

        Text("Discovering your apps…")
          .font(.title3.weight(.medium))
          .foregroundStyle(.primary)
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
    .onAppear { startRevealAnimation() }
    .onDisappear { stopRevealAnimation() }
  }

  private func appIconTile(app: InstalledApp, index: Int) -> some View {
    let isRevealed = index < revealedCount

    return Image(nsImage: appState.appIcon(for: appDecisionStub(app)))
      .resizable()
      .aspectRatio(contentMode: .fit)
      .frame(width: 40, height: 40)
      .opacity(isRevealed ? 1 : 0)
      .scaleEffect(isRevealed ? 1 : 0.6)
      .animation(
        .spring(duration: 0.35, bounce: 0.3).delay(Double(index) * 0.02), value: isRevealed)
  }

  private func appDecisionStub(_ app: InstalledApp) -> AppDecision {
    AppDecision(
      appName: app.name,
      bundleId: app.bundleId,
      installedVersion: app.version,
      matchedAppId: nil,
      matchedAppName: nil,
      matchConfidence: nil,
      decision: .notTracked,
      isVerified: false,
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

  private func startRevealAnimation() {
    revealedCount = 0
    animationTimer = Timer.scheduledTimer(withTimeInterval: 0.06, repeats: true) { _ in
      Task { @MainActor in
        let maxCount = min(appState.installedApps.count, 24)
        if revealedCount < maxCount {
          revealedCount += 1
        } else {
          stopRevealAnimation()
        }
      }
    }
  }

  private func stopRevealAnimation() {
    animationTimer?.invalidate()
    animationTimer = nil
  }
}
