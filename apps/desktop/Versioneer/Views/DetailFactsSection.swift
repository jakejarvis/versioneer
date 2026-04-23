import SwiftUI

struct DetailFactsSection: View {
  @Environment(AppState.self) private var appState

  let result: InventoryResult

  private var installedApp: InstalledApp? {
    appState.installedApp(for: result)
  }

  private var manualUpdateAction: ManualUpdateAction? {
    appState.manualUpdateAction(for: result)
  }

  private var facts: [DetailFact] {
    var facts: [DetailFact] = [
      DetailFact(label: "Source", value: sourceDescription),
      DetailFact(label: "Install Route", value: installRouteDescription),
      DetailFact(label: "Path", value: appState.appPathText(for: result) ?? "Unavailable"),
      DetailFact(label: "Bundle ID", value: appState.bundleIdText(for: result) ?? "Unavailable"),
      DetailFact(label: "Released", value: VersionFormatting.relativeDate(from: result.releasedAt)),
    ]

    if let matchConfidence = result.matchConfidence {
      facts.append(
        DetailFact(label: "Match", value: VersionFormatting.confidenceLabel(matchConfidence)))
    }

    if shouldShowChannel {
      facts.append(DetailFact(label: "Channel", value: currentChannel.capitalized))
    }

    if let artifact = result.artifact {
      if let sizeBytes = artifact.sizeBytes {
        let formatter = ByteCountFormatter()
        formatter.countStyle = .file
        facts.append(
          DetailFact(label: "Download", value: formatter.string(fromByteCount: Int64(sizeBytes)))
        )
      }
      if let minOS = artifact.minOsVersion {
        facts.append(DetailFact(label: "Minimum macOS", value: minOS))
      }
    }

    return facts
  }

  var body: some View {
    DetailPlainSection(title: "Details") {
      VStack(alignment: .leading, spacing: 8) {
        ForEach(facts) { fact in
          DetailFactRowView(fact: fact)
        }
      }
    }
  }

  private var sourceDescription: String {
    if appState.isUserIgnored(result) {
      return "Ignored"
    }
    if appState.isHomebrewInstalled(for: result) {
      return "Homebrew"
    }
    if installedApp?.isMasApp == true {
      return "Mac App Store"
    }
    if installedApp?.isSparkleApp == true {
      return "Sparkle"
    }
    if installedApp?.isElectronApp == true {
      return "Electron"
    }
    return result.isVerified ? "Versioneer Catalog" : "Local Metadata"
  }

  private var installRouteDescription: String {
    if result.decision != .updateAvailable {
      return "No update required"
    }
    if appState.isMasUpgradeable(for: result) {
      return "Mac App Store"
    }
    if appState.isHomebrewInstalled(for: result) {
      return "Homebrew"
    }
    if let strategy = result.installStrategy {
      var parts = [strategy.displayTitle]
      if strategy.requiresAdmin {
        parts.append("admin required")
      }
      if strategy.requiresQuit {
        parts.append("quits app first")
      }
      return parts.joined(separator: " · ")
    }
    if manualUpdateAction != nil {
      return "Manual"
    }
    return "Unavailable"
  }

  private var shouldShowChannel: Bool {
    result.matchedAppId != nil
      && ((result.availableChannels?.count ?? 0) > 1 || result.channel != nil)
  }

  private var currentChannel: String {
    guard let appId = result.matchedAppId else { return result.channel ?? "stable" }
    return appState.settings.channel(forAppId: appId)
  }
}

private struct DetailFact: Identifiable {
  let label: String
  let value: String

  var id: String { label }
}

private struct DetailFactRowView: View {
  let fact: DetailFact

  var body: some View {
    HStack(alignment: .firstTextBaseline, spacing: 14) {
      Text(fact.label)
        .foregroundStyle(.secondary)
        .frame(width: 112, alignment: .leading)

      Text(fact.value)
        .foregroundStyle(.primary)
        .lineLimit(2)
        .truncationMode(.middle)
        .textSelection(.enabled)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
    .font(.callout)
  }
}
