import Foundation

nonisolated struct FilterPresentation: Equatable, Sendable {
  nonisolated struct Chip: Equatable, Identifiable, Sendable {
    let id: String
    let title: String
    let count: Int
    let systemImage: String
  }

  let chips: [Chip]
  let showUpdateAll: Bool
  let updateAllCount: Int

  @MainActor
  static func make(
    summary: AppState.ScanSummary,
    selectedSection: AppState.FilterSection
  ) -> FilterPresentation {
    let chips = AppState.FilterSection.allCases.map { section in
      let count: Int =
        switch section {
        case .all: summary.totalApps
        case .updatesAvailable: summary.updatesAvailableCount
        case .unknown: summary.unknownCount
        case .unsupported: summary.unsupportedCount
        case .ignored: summary.ignoredCount
        }
      return Chip(
        id: section.rawValue,
        title: section.shortTitle,
        count: count,
        systemImage: section.systemImage
      )
    }

    let showUpdateAll =
      (selectedSection == .all || selectedSection == .updatesAvailable)
      && summary.updatesAvailableCount > 0

    return FilterPresentation(
      chips: chips,
      showUpdateAll: showUpdateAll,
      updateAllCount: summary.updatesAvailableCount
    )
  }
}
