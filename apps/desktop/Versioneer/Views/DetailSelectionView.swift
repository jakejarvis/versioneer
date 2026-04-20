import SwiftUI

struct DetailSelectionView: View {
  @Environment(AppState.self) private var appState

  var body: some View {
    if let selectedResult = appState.selectedResult {
      DetailPaneView(result: selectedResult)
        .id(selectedResult.id)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    } else {
      ContentUnavailableView {
        Label("Select an App", systemImage: "sidebar.left")
      } description: {
        Text("Choose an app from the list to view its status, versions, and update actions.")
      }
      .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
  }
}
