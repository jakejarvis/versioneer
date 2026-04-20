import SwiftUI

struct DetailPaneView: View {
  @Environment(AppState.self) private var appState

  let result: AppDecision

  @State private var showFeedbackSheet = false
  @State private var showInstallWarning = false
  @State private var showBrewBypassWarning = false

  var body: some View {
    ScrollView {
      VStack(alignment: .leading, spacing: 22) {
        DetailSummaryPanel(
          result: result,
          showFeedbackSheet: $showFeedbackSheet,
          showInstallWarning: $showInstallWarning,
          showBrewBypassWarning: $showBrewBypassWarning
        )

        DetailFactsSection(result: result)
        DetailReleaseNotesSection(result: result)
      }
      .padding(24)
      .frame(maxWidth: 640, alignment: .leading)
      .frame(maxWidth: .infinity, alignment: .leading)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    .sheet(isPresented: $showFeedbackSheet) {
      FeedbackSheetView(result: result)
    }
    .alert("Install unverified update?", isPresented: $showInstallWarning) {
      Button("Install Update", role: .destructive) {
        Task { await appState.install(result) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "Versioneer will run local verification before installing, but this catalog match still needs review."
      )
    }
    .alert("Install directly?", isPresented: $showBrewBypassWarning) {
      Button("Install Directly", role: .destructive) {
        Task { await appState.install(result) }
      }
      Button("Cancel", role: .cancel) {}
    } message: {
      Text(
        "This app was installed with Homebrew. Installing directly can leave Homebrew out of sync."
      )
    }
  }
}
