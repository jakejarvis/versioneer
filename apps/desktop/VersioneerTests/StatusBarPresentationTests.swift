import Foundation
import Testing

@testable import Versioneer

private let statusBarTestNow = Date(timeIntervalSince1970: 1_774_960_000)

@MainActor
struct StatusBarPresentationTests {
  @Test func displaysFreshnessAndAppCount() {
    let summary = AppState.ScanSummary(
      totalApps: 52,
      updatesAvailableCount: 3,
      localOnlyCount: 1,
      needsReviewCount: 0,
      ignoredCount: 2,
      lastCompletedAt: statusBarTestNow
    )

    let presentation = StatusBarPresentation.make(
      summary: summary,
      loadState: .done,
      now: statusBarTestNow
    )

    #expect(presentation.appCountText == "52 apps")
    #expect(!presentation.isScanning)
    #expect(presentation.lastCheckedText == "just now")
  }

  @Test func showsNeverWhenNoScanCompleted() {
    let summary = AppState.ScanSummary(
      totalApps: 0,
      updatesAvailableCount: 0,
      localOnlyCount: 0,
      needsReviewCount: 0,
      ignoredCount: 0,
      lastCompletedAt: nil
    )

    let presentation = StatusBarPresentation.make(summary: summary, loadState: .idle)

    #expect(presentation.lastCheckedText == "Never")
    #expect(presentation.appCountText == "0 apps")
    #expect(!presentation.isScanning)
  }

  @Test func isScanningDuringScanningState() {
    let summary = AppState.ScanSummary(
      totalApps: 10,
      updatesAvailableCount: 0,
      localOnlyCount: 0,
      needsReviewCount: 0,
      ignoredCount: 1,
      lastCompletedAt: nil
    )

    let scanning = StatusBarPresentation.make(summary: summary, loadState: .scanning)
    let submitting = StatusBarPresentation.make(summary: summary, loadState: .submitting)
    let done = StatusBarPresentation.make(summary: summary, loadState: .done)

    #expect(scanning.isScanning)
    #expect(submitting.isScanning)
    #expect(!done.isScanning)
  }

  @Test func singularAppCountForOneApp() {
    let summary = AppState.ScanSummary(
      totalApps: 1,
      updatesAvailableCount: 0,
      localOnlyCount: 0,
      needsReviewCount: 0,
      ignoredCount: 0,
      lastCompletedAt: statusBarTestNow
    )

    let presentation = StatusBarPresentation.make(
      summary: summary,
      loadState: .done,
      now: statusBarTestNow
    )

    #expect(presentation.appCountText == "1 app")
  }
}
