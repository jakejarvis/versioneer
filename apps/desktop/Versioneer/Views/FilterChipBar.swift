import SwiftUI

struct FilterChipBar: View {
  @Environment(AppState.self) private var appState
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  @State private var hoveredSection: AppState.FilterSection?
  @State private var chipRailMaskState = FilterChipRailMaskState()

  private let chipRailFadeWidth: CGFloat = 18

  var body: some View {
    ScrollView(.horizontal, showsIndicators: false) {
      HStack(spacing: 4) {
        ForEach(AppState.FilterSection.allCases) { section in
          filterChip(for: section)
        }
      }
    }
    .frame(maxWidth: .infinity, alignment: .leading)
    .mask(chipRailMask)
    .onScrollGeometryChange(
      for: FilterChipRailMaskState.self,
      of: { geometry in
        FilterChipRailMaskState(geometry: geometry)
      },
      action: { _, newState in
        chipRailMaskState = newState
      }
    )
    .padding(.horizontal, 16)
    .padding(.vertical, 9)
    .adaptiveMaterial()
    .overlay(alignment: .bottom) {
      Divider()
    }
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
        Image(systemName: isSelected ? section.selectedSystemImage : section.systemImage)
          .font(.callout.weight(.semibold))
        Text(section.shortTitle)
          .font(.callout.weight(.semibold))
          .lineLimit(1)
        Text("\(count)")
          .font(.caption.monospacedDigit().weight(.medium))
          .foregroundStyle(
            isSelected ? Color.accentColor.opacity(0.8) : Color.secondary.opacity(0.65))
      }
      .fixedSize(horizontal: true, vertical: false)
      .padding(.horizontal, 10)
      .padding(.vertical, 5)
      .background(
        isSelected
          ? Color.accentColor.opacity(0.14)
          : (hoveredSection == section ? Color.primary.opacity(0.045) : Color.clear),
        in: .capsule
      )
      .overlay {
        Capsule(style: .continuous)
          .strokeBorder(isSelected ? Color.accentColor.opacity(0.18) : .clear, lineWidth: 1)
      }
    }
    .buttonStyle(.plain)
    .onHover { isHovered in hoveredSection = isHovered ? section : nil }
    .foregroundStyle(isSelected ? Color.accentColor : .secondary)
    .accessibilityLabel("\(section.shortTitle), \(count) apps")
    .accessibilityAddTraits(isSelected ? .isSelected : [])
  }

  private var chipRailMask: some View {
    HStack(spacing: 0) {
      chipRailMaskEdge(
        showsFade: chipRailMaskState.showsLeadingFade,
        colors: [.clear, .black]
      )

      Rectangle()
        .fill(.black)

      chipRailMaskEdge(
        showsFade: chipRailMaskState.showsTrailingFade,
        colors: [.black, .clear]
      )
    }
  }

  @ViewBuilder
  private func chipRailMaskEdge(showsFade: Bool, colors: [Color]) -> some View {
    if showsFade {
      LinearGradient(
        colors: colors,
        startPoint: .leading,
        endPoint: .trailing
      )
      .frame(width: chipRailFadeWidth)
    } else {
      Rectangle()
        .fill(.black)
        .frame(width: chipRailFadeWidth)
    }
  }
}

struct FilterChipRailMaskState: Equatable {
  var showsLeadingFade = false
  var showsTrailingFade = false

  init(showsLeadingFade: Bool = false, showsTrailingFade: Bool = false) {
    self.showsLeadingFade = showsLeadingFade
    self.showsTrailingFade = showsTrailingFade
  }

  init(geometry: ScrollGeometry, fadeThreshold: CGFloat = 6) {
    let visibleRect = geometry.visibleRect
    let contentWidth = geometry.contentSize.width

    showsLeadingFade = visibleRect.minX > fadeThreshold
    showsTrailingFade = visibleRect.maxX < contentWidth - fadeThreshold
  }
}
