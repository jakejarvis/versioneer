import SwiftUI
import Testing

@testable import Versioneer

@MainActor
struct FilterChipRailMaskStateTests {
  @Test func hidesAllFadesWhenContentFits() {
    let state = FilterChipRailMaskState(
      geometry: makeGeometry(contentOffsetX: 0, contentWidth: 180, containerWidth: 240)
    )

    #expect(!state.showsLeadingFade)
    #expect(!state.showsTrailingFade)
  }

  @Test func showsOnlyTrailingFadeAtLeadingEdge() {
    let state = FilterChipRailMaskState(
      geometry: makeGeometry(contentOffsetX: 0, contentWidth: 420, containerWidth: 240)
    )

    #expect(!state.showsLeadingFade)
    #expect(state.showsTrailingFade)
  }

  @Test func showsBothFadesWhileScrolledThroughMiddle() {
    let state = FilterChipRailMaskState(
      geometry: makeGeometry(contentOffsetX: 96, contentWidth: 420, containerWidth: 240)
    )

    #expect(state.showsLeadingFade)
    #expect(state.showsTrailingFade)
  }

  @Test func showsOnlyLeadingFadeAtTrailingEdge() {
    let state = FilterChipRailMaskState(
      geometry: makeGeometry(contentOffsetX: 180, contentWidth: 420, containerWidth: 240)
    )

    #expect(state.showsLeadingFade)
    #expect(!state.showsTrailingFade)
  }

  private func makeGeometry(
    contentOffsetX: CGFloat,
    contentWidth: CGFloat,
    containerWidth: CGFloat
  ) -> ScrollGeometry {
    ScrollGeometry(
      contentOffset: CGPoint(x: contentOffsetX, y: 0),
      contentSize: CGSize(width: contentWidth, height: 44),
      contentInsets: EdgeInsets(top: 0, leading: 0, bottom: 0, trailing: 0),
      containerSize: CGSize(width: containerWidth, height: 44)
    )
  }
}
