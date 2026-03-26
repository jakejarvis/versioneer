import SwiftUI

struct VersioneerCardModifier: ViewModifier {
    var glass: Bool
    var interactive: Bool = false
    var cornerRadius: CGFloat = 22
    var padding: CGFloat = 18

    func body(content: Content) -> some View {
        let card = content
            .padding(padding)
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(.white.opacity(glass ? 0.16 : 0.08), lineWidth: 1)
            }

        if glass {
            if #available(macOS 26.0, *) {
                card
                    .glassEffect(
                        interactive ? .regular.interactive() : .regular,
                        in: .rect(cornerRadius: cornerRadius)
                    )
            } else {
                fallbackCard(card)
            }
        } else {
            fallbackCard(card)
        }
    }

    private func fallbackCard<Body: View>(_ content: Body) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(.ultraThinMaterial.opacity(0.9))
            )
    }
}

extension View {
    func versioneerCard(
        glass: Bool = false,
        interactive: Bool = false,
        cornerRadius: CGFloat = 22,
        padding: CGFloat = 18
    ) -> some View {
        modifier(VersioneerCardModifier(
            glass: glass,
            interactive: interactive,
            cornerRadius: cornerRadius,
            padding: padding
        ))
    }
}

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
        .modifier(ChipGlassModifier(glass: glass))
    }
}

private struct ChipGlassModifier: ViewModifier {
    var glass: Bool

    func body(content: Content) -> some View {
        if glass, #available(macOS 26.0, *) {
            content.glassEffect(.regular, in: .capsule)
        } else {
            content
        }
    }
}

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
