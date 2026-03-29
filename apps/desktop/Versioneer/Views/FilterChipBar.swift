import SwiftUI

struct FilterChipBar: View {
  @Environment(AppState.self) private var appState
  @Environment(\.accessibilityReduceMotion) private var reduceMotion

  @State private var hoveredSection: AppState.FilterSection?
  @State private var chipRailMaskState = FilterChipRailMaskState()

  private let chipRailFadeWidth: CGFloat = 18

  var body: some View {
    HStack(spacing: 12) {
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

      if appState.filterPresentation.showUpdateAll {
        updateAllButton
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
        Image(systemName: isSelected ? section.selectedSystemImage : section.systemImage)
          .font(.callout.weight(.semibold))
        Text(section.shortTitle)
          .font(.callout.weight(.semibold))
          .lineLimit(1)
        Text("\(count)")
          .font(.caption.monospacedDigit().weight(.medium))
          .foregroundStyle(
            isSelected ? Color.accentColor.opacity(0.75) : Color.secondary.opacity(0.65))
      }
      .fixedSize(horizontal: true, vertical: false)
      .padding(.horizontal, 10)
      .padding(.vertical, 6)
      .background(
        isSelected
          ? Color.accentColor.opacity(0.18)
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

  private var updateAllButton: some View {
    Button {
      Task { await appState.installAll() }
    } label: {
      ViewThatFits(in: .horizontal) {
        Label("Update All", systemImage: "arrow.down.circle")
        Text("Update All")
        Image(systemName: "arrow.down.circle")
      }
      .font(.caption.weight(.semibold))
      .lineLimit(1)
    }
    .buttonStyle(.borderedProminent)
    .controlSize(.small)
    .fixedSize(horizontal: true, vertical: false)
    .layoutPriority(1)
    .help("Update all \(appState.filterPresentation.updateAllCount) apps")
    .accessibilityLabel("Update all \(appState.filterPresentation.updateAllCount) apps")
    .transition(
      .motionAware(
        .opacity.combined(with: .scale(scale: 0.9)),
        reduceMotion: reduceMotion
      ))
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
