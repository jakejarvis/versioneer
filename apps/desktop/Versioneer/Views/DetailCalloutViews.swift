import SwiftUI

struct DetailCallout: Identifiable {
  enum Tone {
    case neutral
    case progress
    case success
    case warning
    case failure

    init(_ tone: InstallPresentation.Tone) {
      switch tone {
      case .neutral: self = .neutral
      case .progress: self = .progress
      case .success: self = .success
      case .warning: self = .warning
      case .failure: self = .failure
      }
    }

    var tint: Color {
      switch self {
      case .neutral: .secondary
      case .progress: .accentColor
      case .success: .green
      case .warning: .orange
      case .failure: .red
      }
    }

    var systemImage: String {
      switch self {
      case .neutral: "info.circle.fill"
      case .progress: "arrow.trianglehead.2.clockwise"
      case .success: "checkmark.circle.fill"
      case .warning: "exclamationmark.triangle.fill"
      case .failure: "xmark.circle.fill"
      }
    }
  }

  let id: String
  let title: String
  let detail: String
  let tone: Tone
}

struct DetailCalloutGroup: View {
  let callouts: [DetailCallout]

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      ForEach(callouts) { callout in
        HStack(alignment: .top, spacing: 10) {
          Image(systemName: callout.tone.systemImage)
            .font(.callout.weight(.semibold))
            .foregroundStyle(callout.tone.tint)
            .frame(width: 18)

          VStack(alignment: .leading, spacing: 2) {
            Text(callout.title)
              .font(.callout.weight(.semibold))
            Text(callout.detail)
              .font(.caption)
              .foregroundStyle(.secondary)
              .fixedSize(horizontal: false, vertical: true)
          }

          Spacer(minLength: 0)
        }
      }
    }
    .padding(12)
    .background(Color.primary.opacity(0.045), in: .rect(cornerRadius: 14))
    .overlay {
      RoundedRectangle(cornerRadius: 14, style: .continuous)
        .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
    }
  }
}

struct DetailInlineProgressView: View {
  let progress: InstallPresentation.Progress
  let detail: String?

  var body: some View {
    VStack(alignment: .leading, spacing: 8) {
      HStack {
        Text(progress.title)
          .font(.callout.weight(.semibold))
        Spacer()
        Text("Step \(progress.currentStep) of \(progress.totalSteps)")
          .font(.caption)
          .foregroundStyle(.secondary)
      }

      ProgressView(value: Double(progress.currentStep), total: Double(progress.totalSteps))
        .progressViewStyle(.linear)
        .tint(.accentColor)

      if let detail, !detail.isEmpty {
        Text(detail)
          .font(.caption)
          .foregroundStyle(.secondary)
      }
    }
  }
}

struct DetailPlainSection<Content: View>: View {
  let title: String
  @ViewBuilder let content: Content

  var body: some View {
    VStack(alignment: .leading, spacing: 12) {
      Text(title)
        .font(.subheadline.weight(.semibold))

      content
    }
    .frame(maxWidth: .infinity, alignment: .leading)
  }
}
