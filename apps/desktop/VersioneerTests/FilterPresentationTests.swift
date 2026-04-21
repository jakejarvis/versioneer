import Foundation
import Testing

@testable import Versioneer

private let filterPresentationTestDate = Date(timeIntervalSince1970: 1_774_960_000)

@MainActor
struct FilterPresentationTests {
  @Test func chipsReflectSummaryCounts() {
    let summary = AppState.ScanSummary(
      totalApps: 50,
      updatesAvailableCount: 3,
      localOnlyCount: 2,
      needsReviewCount: 1,
      ignoredCount: 4,
      lastCompletedAt: filterPresentationTestDate
    )

    let presentation = FilterPresentation.make(summary: summary, selectedSection: .all)

    #expect(presentation.chips.count == 5)
    #expect(presentation.chips[0].title == "All")
    #expect(presentation.chips[0].count == 50)
    #expect(presentation.chips[1].title == "Updates")
    #expect(presentation.chips[1].count == 3)
    #expect(presentation.chips[2].title == "Local Only")
    #expect(presentation.chips[2].count == 2)
    #expect(presentation.chips[3].title == "Review")
    #expect(presentation.chips[3].count == 1)
    #expect(presentation.chips[4].title == "Ignored")
    #expect(presentation.chips[4].count == 4)
  }

  @Test func updateAllVisibleWhenAllSectionSelectedWithUpdates() {
    let summary = AppState.ScanSummary(
      totalApps: 50,
      updatesAvailableCount: 3,
      localOnlyCount: 0,
      needsReviewCount: 0,
      ignoredCount: 2,
      lastCompletedAt: filterPresentationTestDate
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
      localOnlyCount: 0,
      needsReviewCount: 0,
      ignoredCount: 0,
      lastCompletedAt: filterPresentationTestDate
    )

    let presentation = FilterPresentation.make(summary: summary, selectedSection: .all)

    #expect(!presentation.showUpdateAll)
    #expect(presentation.updateAllCount == 0)
  }

  @Test func updateAllHiddenWhenLocalOnlyOrReviewSectionSelected() {
    let summary = AppState.ScanSummary(
      totalApps: 50,
      updatesAvailableCount: 5,
      localOnlyCount: 2,
      needsReviewCount: 1,
      ignoredCount: 1,
      lastCompletedAt: filterPresentationTestDate
    )

    let localOnlySelected = FilterPresentation.make(
      summary: summary, selectedSection: .localOnly)
    let needsReviewSelected = FilterPresentation.make(
      summary: summary, selectedSection: .needsReview)
    let ignoredSelected = FilterPresentation.make(summary: summary, selectedSection: .ignored)

    #expect(!localOnlySelected.showUpdateAll)
    #expect(!needsReviewSelected.showUpdateAll)
    #expect(!ignoredSelected.showUpdateAll)
  }
}
