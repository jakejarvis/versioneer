import AppKit
import SwiftUI

// MARK: - Glass Card Modifier

struct GlassCardModifier: ViewModifier {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  var interactive: Bool = false
  var cornerRadius: CGFloat = 22
  var padding: CGFloat = 18

  func body(content: Content) -> some View {
    content
      .padding(padding)
      .if(reduceTransparency) {
        $0.background(
          Color(nsColor: .controlBackgroundColor),
          in: .rect(cornerRadius: cornerRadius)
        )
      }
      .if(!reduceTransparency) {
        $0.glassEffect(
          interactive ? .regular.interactive() : .regular,
          in: .rect(cornerRadius: cornerRadius)
        )
      }
  }
}

extension View {
  func glassCard(
    interactive: Bool = false,
    cornerRadius: CGFloat = 22,
    padding: CGFloat = 18
  ) -> some View {
    modifier(
      GlassCardModifier(
        interactive: interactive,
        cornerRadius: cornerRadius,
        padding: padding
      ))
  }
}

// MARK: - Tone

enum DesignTone: String, Sendable {
  case accent
  case positive
  case attention
  case error
  case neutral

  var color: Color {
    switch self {
    case .accent: .accentColor
    case .positive: .green
    case .attention: .orange
    case .error: .red
    case .neutral: .secondary
    }
  }
}

// MARK: - Status Chip

struct StatusChip: View {
  let title: String
  let tint: Color
  var systemImage: String?
  var showsProgress = false
  var interactive = false

  @State private var isHovered = false

  var body: some View {
    HStack(spacing: 6) {
      if showsProgress {
        ProgressView()
          .controlSize(.small)
      } else if let systemImage {
        Image(systemName: systemImage)
          .font(.caption.weight(.semibold))
      }

      Text(title)
        .font(.caption.weight(.semibold))
        .lineLimit(1)
    }
    .foregroundStyle(tint)
    .padding(.horizontal, 10)
    .padding(.vertical, 6)
    .background(chipBackground, in: .capsule)
    .accessibilityElement(children: .combine)
    .onHover { hovering in
      guard interactive else { return }
      isHovered = hovering
    }
  }

  private var chipBackground: Color {
    guard interactive else { return tint.opacity(0.12) }
    return tint.opacity(isHovered ? 0.18 : 0.12)
  }
}

// MARK: - Glass Banner

struct GlassBanner: View {
  let title: String
  let detail: String
  let tint: Color

  var body: some View {
    HStack(alignment: .top, spacing: 12) {
      Circle()
        .fill(tint)
        .frame(width: 9, height: 9)
        .padding(.top, 6)

      VStack(alignment: .leading, spacing: 4) {
        Text(title)
          .font(.subheadline.weight(.semibold))
        Text(detail)
          .font(.callout)
          .foregroundStyle(.secondary)
          .fixedSize(horizontal: false, vertical: true)
      }

      Spacer(minLength: 0)
    }
    .glassCard(cornerRadius: 18, padding: 14)
    .focusEffectDisabled()
    .accessibilityElement(children: .combine)
  }
}

// MARK: - Section Header

struct SectionHeader: View {
  let title: String
  var subtitle: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 4) {
      Text(title)
        .font(.subheadline.weight(.semibold))

      if let subtitle {
        Text(subtitle)
          .font(.callout)
          .foregroundStyle(.secondary)
      }
    }
  }
}

// MARK: - Version Diff Label

struct VersionDiffLabel: View {
  let installed: String
  let latest: String

  var body: some View {
    HStack(spacing: 6) {
      Text(installed)
        .foregroundStyle(.tertiary)
      Image(systemName: "chevron.right")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
      Text(latest)
        .fontWeight(.semibold)
        .foregroundStyle(Color.accentColor)
    }
    .font(.callout.monospacedDigit())
    .accessibilityElement(children: .combine)
    .accessibilityLabel("Version \(installed) to \(latest)")
  }
}

// MARK: - Metadata Popover Button

struct MetadataPopoverButton: View {
  let result: AppDecision

  @State private var showPopover = false
  @State private var isHovered = false

  var body: some View {
    Button {
      showPopover.toggle()
    } label: {
      Image(systemName: "info.circle")
        .font(.body)
        .foregroundStyle(isHovered ? .primary : .secondary)
    }
    .buttonStyle(.plain)
    .onHover { isHovered = $0 }
    .accessibilityLabel("App details")
    .accessibilityHint("Shows bundle ID, canonical name, and other technical details")
    .popover(isPresented: $showPopover, arrowEdge: .trailing) {
      VStack(alignment: .leading, spacing: 10) {
        ForEach(metadataFields, id: \.label) { field in
          metadataRow(field.label, value: field.value)
        }

        Divider()

        Button("Copy All") {
          let text = metadataFields.map { "\($0.label): \($0.value)" }.joined(separator: "\n")
          NSPasteboard.general.clearContents()
          NSPasteboard.general.setString(text, forType: .string)
        }
        .buttonStyle(.link)
      }
      .padding(16)
      .frame(minWidth: 280)
    }
  }

  private var metadataFields: [(label: String, value: String)] {
    var fields = [
      (label: "Bundle ID", value: result.bundleId ?? "—"),
      (label: "App Name", value: result.appName),
    ]
    if let matched = result.matchedAppName {
      fields.append((label: "Canonical Name", value: matched))
    }
    if let matchedId = result.matchedAppId {
      fields.append((label: "Matched App ID", value: matchedId))
    }
    if let minOS = result.artifact?.minOsVersion {
      fields.append((label: "Minimum macOS", value: minOS))
    }
    return fields
  }

  private func metadataRow(_ label: String, value: String) -> some View {
    LabeledContent(label) {
      Text(value)
        .font(.callout.monospacedDigit())
        .foregroundStyle(.secondary)
        .textSelection(.enabled)
    }
  }
}

// MARK: - Install Progress View

struct InstallProgressView: View {
  let progress: InstallPresentation.Progress

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack {
        Text(progress.title)
          .font(.subheadline.weight(.semibold))
        Spacer()
        Text("Step \(progress.currentStep) of \(progress.totalSteps)")
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      GlassEffectContainer(spacing: 4) {
        HStack(spacing: 4) {
          ForEach(1...progress.totalSteps, id: \.self) { step in
            Capsule(style: .continuous)
              .fill(step <= progress.currentStep ? Color.accentColor : Color.primary.opacity(0.08))
              .frame(height: 6)
              .if(step <= progress.currentStep) {
                $0.glassEffect(.regular, in: .capsule)
              }
          }
        }
      }
    }
    .glassCard(cornerRadius: 18, padding: 14)
    .focusEffectDisabled()
    .accessibilityElement(children: .combine)
    .accessibilityLabel("\(progress.title), step \(progress.currentStep) of \(progress.totalSteps)")
  }
}

// MARK: - Detail Fact Row

struct DetailFactRow: View {
  let label: String
  let value: String

  var body: some View {
    LabeledContent(label) {
      Text(value)
        .font(.callout.monospacedDigit())
        .foregroundStyle(.secondary)
        .multilineTextAlignment(.trailing)
    }
  }
}

// MARK: - Row Tone Color Mapping

extension ResultsBrowserRowPresentation.Tone {
  var color: Color {
    switch self {
    case .accent: .accentColor
    case .positive: .green
    case .attention: .orange
    case .error: .red
    case .neutral: .secondary
    }
  }
}

// MARK: - App Context Menu Items

struct AppContextMenuItems: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

  var body: some View {
    let hasPath = appState.appPathText(for: result) != nil
    let hasBundleId = appState.bundleIdText(for: result) != nil

    Button("Open App") {
      appState.openApp(result)
    }
    .disabled(!hasPath)

    Button("Show in Finder") {
      appState.revealAppInFinder(result)
    }
    .disabled(!hasPath)

    Divider()

    Button("Copy Bundle ID") {
      appState.copyBundleId(result)
    }
    .disabled(!hasBundleId)

    Button("Copy Path") {
      appState.copyAppPath(result)
    }
    .disabled(!hasPath)
  }
}

// MARK: - Adaptive Material Modifier

/// Replaces `.ultraThinMaterial` with a solid background when the user
/// has enabled Reduce Transparency in System Settings.
struct AdaptiveMaterialModifier: ViewModifier {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  func body(content: Content) -> some View {
    if reduceTransparency {
      content.background(Color(nsColor: .windowBackgroundColor))
    } else {
      content.background(.ultraThinMaterial)
    }
  }
}

extension View {
  func adaptiveMaterial() -> some View {
    modifier(AdaptiveMaterialModifier())
  }
}

// MARK: - Translucent Window Background

struct TranslucentWindowBackground: NSViewRepresentable {
  @Environment(\.accessibilityReduceTransparency) private var reduceTransparency

  func makeNSView(context: Context) -> NSVisualEffectView {
    let view = NSVisualEffectView()
    view.material = .underWindowBackground
    view.blendingMode = .behindWindow
    view.state = .active

    DispatchQueue.main.async {
      view.window?.isOpaque = false
      view.window?.backgroundColor = .clear
    }

    return view
  }

  func updateNSView(_ nsView: NSVisualEffectView, context: Context) {
    nsView.state = reduceTransparency ? .inactive : .active
  }
}

// MARK: - Conditional Modifier

extension View {
  @ViewBuilder
  func `if`<Content: View>(_ condition: Bool, transform: (Self) -> Content) -> some View {
    if condition {
      transform(self)
    } else {
      self
    }
  }
}
