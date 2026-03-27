import SwiftUI

// MARK: - Card Modifier

struct VersioneerCardModifier: ViewModifier {
  var glass: Bool
  var interactive: Bool = false
  var cornerRadius: CGFloat = 22
  var padding: CGFloat = 18

  func body(content: Content) -> some View {
    let card =
      content
      .padding(padding)
      .overlay {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
          .strokeBorder(.white.opacity(glass ? 0.16 : 0.08), lineWidth: 1)
      }

    if glass {
      card
        .glassEffect(
          interactive ? .regular.interactive() : .regular,
          in: .rect(cornerRadius: cornerRadius)
        )
    } else {
      card
        .background(
          RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(.ultraThinMaterial.opacity(0.9))
        )
    }
  }
}

extension View {
  func versioneerCard(
    glass: Bool = false,
    interactive: Bool = false,
    cornerRadius: CGFloat = 22,
    padding: CGFloat = 18
  ) -> some View {
    modifier(
      VersioneerCardModifier(
        glass: glass,
        interactive: interactive,
        cornerRadius: cornerRadius,
        padding: padding
      ))
  }
}

// MARK: - Status Chip

struct VersioneerStatusChip: View {
  let title: String
  let tint: Color
  var systemImage: String?
  var showsProgress = false
  var glass = false

  var body: some View {
    HStack(spacing: 8) {
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
    .background {
      Capsule(style: .continuous)
        .fill(tint.opacity(glass ? 0.15 : 0.12))
    }
    .overlay {
      Capsule(style: .continuous)
        .strokeBorder(tint.opacity(0.2), lineWidth: 1)
    }
    .if(glass) { view in
      view.glassEffect(.regular, in: .capsule)
    }
  }
}

// MARK: - Banner

struct VersioneerBannerView: View {
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
    .versioneerCard(glass: true, cornerRadius: 18, padding: 14)
  }
}

// MARK: - Section Header

struct VersioneerSectionHeader: View {
  let eyebrow: String?
  let title: String
  let subtitle: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 5) {
      if let eyebrow {
        Text(eyebrow.uppercased())
          .font(.caption.weight(.semibold))
          .foregroundStyle(.secondary)
          .tracking(0.8)
      }

      Text(title)
        .font(.title3.weight(.semibold))

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
      Image(systemName: "arrow.right")
        .font(.caption2.weight(.bold))
        .foregroundStyle(.secondary)
      Text(latest)
        .foregroundStyle(.orange)
    }
    .font(.callout.monospacedDigit())
  }
}

// MARK: - Metadata Popover Button

struct MetadataPopoverButton: View {
  let result: AppDecision

  @State private var showPopover = false

  var body: some View {
    Button {
      showPopover.toggle()
    } label: {
      Image(systemName: "info.circle")
        .font(.body)
        .foregroundStyle(.secondary)
    }
    .buttonStyle(.plain)
    .popover(isPresented: $showPopover, arrowEdge: .trailing) {
      VStack(alignment: .leading, spacing: 10) {
        metadataRow("Bundle ID", value: result.bundleId ?? "—")
        metadataRow("App Name", value: result.appName)
        if let matched = result.matchedAppName {
          metadataRow("Canonical Name", value: matched)
        }
        if let matchedId = result.matchedAppId {
          metadataRow("Matched App ID", value: matchedId)
        }
        if let teamId = result.artifact?.expectedTeamId {
          metadataRow("Expected Team ID", value: teamId)
        }
        if let minOS = result.artifact?.minOsVersion {
          metadataRow("Minimum macOS", value: minOS)
        }
      }
      .padding(16)
      .frame(minWidth: 280)
    }
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

      HStack(spacing: 8) {
        ForEach(1...progress.totalSteps, id: \.self) { step in
          Capsule(style: .continuous)
            .fill(step <= progress.currentStep ? Color.accentColor : Color.white.opacity(0.08))
            .frame(height: 7)
        }
      }
    }
    .versioneerCard(glass: false, cornerRadius: 18, padding: 14)
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

// MARK: - Vibrant Color Helpers

extension ResultsBrowserRowPresentation.Tone {
  var color: Color {
    switch self {
    case .accent:
      .accentColor
    case .positive:
      .green
    case .warning:
      .orange
    case .negative:
      .red
    case .secondary:
      .purple
    }
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
