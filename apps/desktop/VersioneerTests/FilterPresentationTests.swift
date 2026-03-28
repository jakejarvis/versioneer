import Foundation
import Testing

@testable import Versioneer

@MainActor
struct FilterPresentationTests {
  @Test func chipsReflectSummaryCounts() {
    let summary = AppState.ScanSummary(
      totalApps: 50,
      updatesAvailableCount: 3,
      notTrackedCount: 2,
      ignoredCount: 4,
      lastCompletedAt: Date()
    )

    let presentation = FilterPresentation.make(summary: summary, selectedSection: .all)

    #expect(presentation.chips.count == 4)
    #expect(presentation.chips[0].title == "All")
    #expect(presentation.chips[0].count == 50)
    #expect(presentation.chips[1].title == "Updates")
    #expect(presentation.chips[1].count == 3)
    #expect(presentation.chips[2].title == "Not Tracked")
    #expect(presentation.chips[2].count == 2)
    #expect(presentation.chips[3].title == "Ignored")
    #expect(presentation.chips[3].count == 4)
  }

  @Test func updateAllVisibleWhenAllSectionSelectedWithUpdates() {
    let summary = AppState.ScanSummary(
      totalApps: 50,
      updatesAvailableCount: 3,
      notTrackedCount: 0,
      ignoredCount: 2,
      lastCompletedAt: Date()
    )

    let allSelected = FilterPresentation.make(summary: summary, selectedSection: .all)
    let updatesSelected = FilterPresentation.make(
      summary: summary, selectedSection: .updatesAvailable)

    #expect(allSelected.showUpdateAll)
    #expect(allSelected.updateAllCount == 3)
    #expect(updatesSelected.showUpdateAll)
  }

  @Test func updateAllHiddenWhenNoUpdatesAvailable() {
    let summary = AppState.ScanSummary(
      totalApps: 50,
      updatesAvailableCount: 0,
      notTrackedCount: 0,
      ignoredCount: 0,
      lastCompletedAt: Date()
    )

    let presentation = FilterPresentation.make(summary: summary, selectedSection: .all)

    #expect(!presentation.showUpdateAll)
    #expect(presentation.updateAllCount == 0)
  }

  @Test func updateAllHiddenWhenNotTrackedSectionSelected() {
    let summary = AppState.ScanSummary(
      totalApps: 50,
      updatesAvailableCount: 5,
      notTrackedCount: 2,
      ignoredCount: 1,
      lastCompletedAt: Date()
    )

    let notTrackedSelected = FilterPresentation.make(
      summary: summary, selectedSection: .notTracked)
    let ignoredSelected = FilterPresentation.make(summary: summary, selectedSection: .ignored)

    #expect(!notTrackedSelected.showUpdateAll)
    #expect(!ignoredSelected.showUpdateAll)
  }
}
