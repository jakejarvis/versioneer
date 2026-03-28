import SwiftUI

struct FilterChipBar: View {
  @Environment(AppState.self) private var appState
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  @State private var hoveredSection: AppState.FilterSection?

  var body: some View {
    @Bindable var appState = appState

    HStack(spacing: 12) {
      ScrollView(.horizontal, showsIndicators: false) {
        HStack(spacing: 4) {
          ForEach(AppState.FilterSection.allCases) { section in
            filterChip(for: section)
          }
        }
      }
      .frame(maxWidth: .infinity, alignment: .leading)
      .layoutPriority(1)
      .mask(chipRailMask)

      if appState.filterPresentation.showUpdateAll {
        Button {
          Task { await appState.installAll() }
        } label: {
          ViewThatFits(in: .horizontal) {
            Label(
              "Update All (\(appState.filterPresentation.updateAllCount))",
              systemImage: "arrow.down.circle"
            )

            Label(
              "\(appState.filterPresentation.updateAllCount)",
              systemImage: "arrow.down.circle"
            )

            Image(systemName: "arrow.down.circle")
          }
          .font(.caption.weight(.semibold))
          .lineLimit(1)
        }
        .buttonStyle(.borderedProminent)
        .controlSize(.small)
        .help("Update all \(appState.filterPresentation.updateAllCount) app(s)")
        .accessibilityLabel("Update all \(appState.filterPresentation.updateAllCount) apps")
        .transition(
          .motionAware(
            .opacity.combined(with: .scale(scale: 0.9)),
            reduceMotion: reduceMotion
          ))
      }
    }
    .padding(.horizontal, 16)
    .padding(.vertical, 10)
    .adaptiveMaterial()
    .overlay(alignment: .bottom) {
      Divider()
    }
    .motionAwareAnimation(.spring(duration: 0.25), value: appState.filterPresentation.showUpdateAll)
  }

  private func filterChip(for section: AppState.FilterSection) -> some View {
    let isSelected = appState.selectedSection == section
    let chip = appState.filterPresentation.chips.first { $0.id == section.rawValue }
    let count = chip?.count ?? 0

    return Button {
      withMotionAwareAnimation(reduceMotion: reduceMotion, full: .spring(duration: 0.2)) {
        appState.setSelectedSection(section)
      }
    } label: {
      HStack(spacing: 5) {
        Image(systemName: section.systemImage)
          .font(.caption2.weight(.semibold))
        Text(section.shortTitle)
          .font(.caption.weight(.semibold))
          .lineLimit(1)
        Text("\(count)")
          .font(.caption2.monospacedDigit().weight(.medium))
          .foregroundStyle(
            isSelected ? Color.accentColor.opacity(0.6) : Color.secondary.opacity(0.6))
      }
      .fixedSize(horizontal: true, vertical: false)
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
      .background(
        isSelected
          ? Color.accentColor.opacity(0.12)
          : (hoveredSection == section ? Color.primary.opacity(0.04) : Color.clear),
        in: .capsule
      )
    }
    .buttonStyle(.plain)
    .onHover { isHovered in hoveredSection = isHovered ? section : nil }
    .foregroundStyle(isSelected ? Color.accentColor : .secondary)
    .accessibilityLabel("\(section.shortTitle), \(count) apps")
    .accessibilityAddTraits(isSelected ? .isSelected : [])
  }

  private var chipRailMask: some View {
    HStack(spacing: 0) {
      LinearGradient(
        colors: [.clear, .black],
        startPoint: .leading,
        endPoint: .trailing
      )
      .frame(width: 10)

      Rectangle()
        .fill(.black)

      LinearGradient(
        colors: [.black, .clear],
        startPoint: .leading,
        endPoint: .trailing
      )
      .frame(width: 10)
    }
  }
}
